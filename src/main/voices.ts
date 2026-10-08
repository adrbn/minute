// Séparation des voix (expérimental). Le moteur calcule, sur l'ordinateur, une empreinte
// de la voix de chaque extrait (modèle CAM++ de 3D-Speaker) ; ici on regroupe les empreintes
// proches : chaque groupe devient un intervenant (« Participant A, B, C… », renommable).
// Les empreintes sont gardées dans le dossier de la réunion (voices.jsonl) pour pouvoir
// affiner les groupes en fin de réunion, ou après un redémarrage.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cosine } from '../shared/fbank';
import type { Channel, MeetingMeta, Segment, Voice } from '../shared/types';

/** similarité à partir de laquelle un extrait rejoint une voix connue (calibré sur CAM++) */
export const JOIN = 0.5;
/** extrait court : empreinte moins fiable, on se contente de rattacher à la voix la plus proche */
const JOIN_SHORT = 0.35;
/** deux groupes aussi proches sont la même personne (calibré sur une vraie réunion de 55 min) */
export const MERGE = 0.5;
const NEW_VOICE_MS = 1500;
/** un groupe de moins de 15 s de parole n'est presque jamais une vraie personne : une variante de voix
 *  (ton, distance au micro) qu'on rend à la voix la plus proche */
export const ABSORB_MS = 15_000;
/** en réunion, on laisse 2 minutes à une nouvelle voix pour se confirmer avant de l'absorber */
const ABSORB_AFTER_MS = 120_000;

interface Print {
  id: string;
  ch: Channel;
  dur: number;
  v: Float32Array;
}
interface Cluster {
  key: string;
  ch: Channel;
  sum: Float32Array;
  count: number;
  ms: number;
  /** création (ms) ; 0 pour un groupe relu depuis le disque */
  born: number;
}
interface State {
  prints: Print[];
  clusters: Cluster[];
  last: Partial<Record<Channel, { spk?: string; t1: number }>>;
}

/** Accès au disque et aux métadonnées (injectés : testable sans Electron). */
export interface VoiceStore {
  dir(id: string): string | null;
  meta(id: string): MeetingMeta | null;
  segments(id: string): Segment[];
  setVoices(id: string, voices: Record<string, Voice>): void;
  putSegment(id: string, seg: Segment): void;
}

const pack = (v: Float32Array) => Buffer.from(Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * 127)))).buffer).toString('base64');
const unpack = (s: string) => {
  const b = Buffer.from(s, 'base64');
  return Float32Array.from(new Int8Array(b.buffer, b.byteOffset, b.length), (x) => x / 127);
};
const unit = (v: ArrayLike<number>) => {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
};

export class Voices {
  private states = new Map<string, State>();

  constructor(private readonly io: VoiceStore) {}

  private state(id: string): State {
    let st = this.states.get(id);
    if (st) return st;
    st = { prints: [], clusters: [], last: {} };
    // reprise (redémarrage en pleine réunion) : empreintes et groupes relus depuis le disque
    const dir = this.io.dir(id);
    const file = dir && join(dir, 'voices.jsonl');
    if (file && existsSync(file)) {
      const spkOf = new Map(this.io.segments(id).map((s) => [s.id, s.spk]));
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        try {
          const p = JSON.parse(line) as { id: string; ch: Channel; d: number; v: string };
          const print = { id: p.id, ch: p.ch, dur: p.d, v: unpack(p.v) };
          st.prints.push(print);
          const spk = spkOf.get(p.id);
          if (spk) this.addTo(st, spk, print, 0);
        } catch {
          /* ligne tronquée */
        }
      }
    }
    this.states.set(id, st);
    return st;
  }

  private addTo(st: State, key: string, p: Print, born = Date.now()) {
    let c = st.clusters.find((k) => k.key === key);
    if (!c) {
      c = { key, ch: p.ch, sum: new Float32Array(p.v.length), count: 0, ms: 0, born };
      st.clusters.push(c);
    }
    for (let i = 0; i < p.v.length; i++) c.sum[i] += p.v[i];
    c.count++;
    c.ms += p.dur;
  }

  /** Voix d'un nouvel extrait (clé de l'intervenant), ou rien si on ne sait pas. */
  assign(id: string, seg: Pick<Segment, 'id' | 'ch' | 't0' | 't1'>, voice?: ArrayLike<number>): string | undefined {
    const st = this.state(id);
    const dur = seg.t1 - seg.t0;
    const last = st.last[seg.ch];
    const follow = last && seg.t0 - last.t1 < 2500 ? last.spk : undefined;
    let spk: string | undefined;
    if (!voice || voice.length < 16) {
      spk = follow; // trop court pour une empreinte : sans doute la même personne qui continue
    } else {
      const p: Print = { id: seg.id, ch: seg.ch, dur, v: unit(voice) };
      st.prints.push(p);
      const dir = this.io.dir(id);
      if (dir) appendFileSync(join(dir, 'voices.jsonl'), JSON.stringify({ id: p.id, ch: p.ch, d: dur, v: pack(p.v) }) + '\n', 'utf8');
      let best: Cluster | null = null;
      let sim = -1;
      for (const c of st.clusters) {
        if (c.ch !== seg.ch) continue;
        const s = cosine(p.v, c.sum);
        if (s > sim) {
          sim = s;
          best = c;
        }
      }
      if (best && sim >= (dur < NEW_VOICE_MS ? JOIN_SHORT : JOIN)) {
        this.addTo(st, best.key, p);
        spk = best.key;
      } else if (dur >= NEW_VOICE_MS) {
        spk = this.newVoice(id, st, p);
      } else {
        spk = follow;
      }
    }
    st.last[seg.ch] = { spk, t1: seg.t1 };
    return spk;
  }

  private newVoice(id: string, st: State, p: Print): string {
    const voices = { ...(this.io.meta(id)?.voices ?? {}) };
    let k = 1;
    while (voices[`${p.ch}${k}`]) k++;
    const key = `${p.ch}${k}`;
    const owner = p.ch === 'me' && !Object.values(voices).some((v) => v.owner);
    const n = owner ? 0 : Object.values(voices).filter((v) => !v.owner).length + 1;
    voices[key] = { n, ...(owner ? { owner: true } : {}) };
    this.io.setVoices(id, voices);
    this.addTo(st, key, p);
    return key;
  }

  /**
   * Fin de réunion : fusionne les groupes qui sont en fait la même voix, rattache chaque extrait
   * à la voix la plus proche (les premiers extraits ont été classés quand on en savait peu),
   * et renumérote. Renvoie les extraits dont l'intervenant a changé.
   */
  refine(id: string): Segment[] {
    const st = this.state(id);
    this.states.delete(id);
    if (!st.prints.length) return [];
    const meta = this.io.meta(id);
    const voices: Record<string, Voice> = { ...(meta?.voices ?? {}) };
    const alias = new Map<string, string>();
    this.mergeClose(st, voices, alias);
    this.absorbSmall(st, voices, alias, Infinity);
    const resolve = (k?: string) => {
      while (k && alias.has(k)) k = alias.get(k);
      return k;
    };

    // chaque empreinte va à la voix la plus proche
    const spkOf = new Map<string, string>();
    for (const p of st.prints) {
      let best: Cluster | null = null;
      let sim = -1;
      for (const c of st.clusters) {
        if (c.ch !== p.ch) continue;
        const s = cosine(p.v, c.sum);
        if (s > sim) {
          sim = s;
          best = c;
        }
      }
      if (best && sim >= JOIN_SHORT) spkOf.set(p.id, best.key);
    }

    // l'utilisateur est la voix qui parle le plus dans son micro ; les autres sont numérotées dans l'ordre d'apparition
    const mine = st.clusters.filter((c) => c.ch === 'me').sort((a, b) => b.ms - a.ms)[0];
    const segments = this.io.segments(id);
    const order: string[] = [];
    // un intervenant choisi à la main n'est pas remis en cause (ni sa voix, même sans empreinte)
    const chosen = (s: Segment) => (s.manual ? resolve(s.spk) : (spkOf.get(s.id) ?? resolve(s.spk)));
    const manualKeys = new Set(segments.filter((s) => s.manual).map((s) => resolve(s.spk)));
    for (const s of segments) {
      const k = chosen(s);
      if (k && !order.includes(k)) order.push(k);
    }
    let n = 0;
    const next: Record<string, Voice> = {};
    for (const k of order) {
      if (!st.clusters.some((c) => c.key === k) && !(manualKeys.has(k) && voices[k])) continue;
      const owner = k === mine?.key;
      next[k] = { ...(voices[k]?.name ? { name: voices[k].name } : {}), n: owner ? 0 : ++n, ...(owner ? { owner: true } : {}) };
    }
    this.io.setVoices(id, next);

    const changed: Segment[] = [];
    for (const s of segments) {
      const k = chosen(s);
      const spk = k && next[k] ? k : undefined;
      if (spk !== s.spk) {
        const seg = { ...s, spk };
        this.io.putSegment(id, seg);
        changed.push(seg);
      }
    }
    return changed;
  }

  /**
   * En réunion (toutes les 2 min) : regroupe les voix qui sont la même personne et rend les petits
   * groupes, une fois confirmés comme tels, à la voix la plus proche. Les lettres déjà affichées ne
   * changent pas (la renumérotation se fait en fin de réunion). Renvoie les extraits réattribués.
   */
  consolidate(id: string): Segment[] {
    const st = this.states.get(id);
    if (!st || st.clusters.length < 2) return [];
    const voices: Record<string, Voice> = { ...(this.io.meta(id)?.voices ?? {}) };
    const alias = new Map<string, string>();
    this.mergeClose(st, voices, alias);
    this.absorbSmall(st, voices, alias, Date.now() - ABSORB_AFTER_MS);
    if (!alias.size) return [];
    const resolve = (k?: string) => {
      while (k && alias.has(k)) k = alias.get(k);
      return k;
    };
    this.io.setVoices(id, voices);
    for (const ch of Object.keys(st.last) as Channel[]) {
      const l = st.last[ch];
      if (l) l.spk = resolve(l.spk);
    }
    const changed: Segment[] = [];
    for (const s of this.io.segments(id)) {
      const k = resolve(s.spk);
      if (k !== s.spk) {
        const seg = { ...s, spk: k };
        this.io.putSegment(id, seg);
        changed.push(seg);
      }
    }
    return changed;
  }

  /** Fusionne `gone` dans `keep` (nom de l'utilisateur et statut « moi » conservés). */
  private fold(st: State, voices: Record<string, Voice>, alias: Map<string, string>, keep: Cluster, gone: Cluster) {
    for (let i = 0; i < keep.sum.length; i++) keep.sum[i] += gone.sum[i];
    keep.count += gone.count;
    keep.ms += gone.ms;
    st.clusters = st.clusters.filter((c) => c !== gone);
    alias.set(gone.key, keep.key);
    const g = voices[gone.key];
    if (g?.name && !voices[keep.key]?.name) voices[keep.key] = { ...voices[keep.key], name: g.name };
    if (g?.owner) voices[keep.key] = { ...voices[keep.key], owner: true, n: 0 };
    delete voices[gone.key];
  }

  /** Deux groupes proches = la même personne ; on garde le plus fourni. Jamais deux noms différents. */
  private mergeClose(st: State, voices: Record<string, Voice>, alias: Map<string, string>) {
    for (;;) {
      let pair: [Cluster, Cluster] | null = null;
      let best = MERGE;
      for (const a of st.clusters)
        for (const b of st.clusters) {
          if (a === b || a.ch !== b.ch || a.key > b.key) continue;
          const na = voices[a.key]?.name;
          const nb = voices[b.key]?.name;
          if (na && nb && na !== nb) continue;
          const s = cosine(a.sum, b.sum);
          if (s >= best) {
            best = s;
            pair = [a, b];
          }
        }
      if (!pair) return;
      const [keep, gone] = pair[0].ms >= pair[1].ms ? pair : [pair[1], pair[0]];
      this.fold(st, voices, alias, keep, gone);
    }
  }

  /** Petits groupes (< 15 s, sans nom, nés avant `bornBefore`) rendus à la voix la plus proche du même canal. */
  private absorbSmall(st: State, voices: Record<string, Voice>, alias: Map<string, string>, bornBefore: number) {
    const small = st.clusters
      .filter((c) => c.ms < ABSORB_MS && c.born < bornBefore && !voices[c.key]?.name)
      .sort((a, b) => a.ms - b.ms);
    for (const c of small) {
      const targets = st.clusters.filter((o) => o !== c && o.ch === c.ch && o.ms >= ABSORB_MS);
      if (!targets.length) continue;
      let best = targets[0];
      let sim = -2;
      for (const o of targets) {
        const s = cosine(c.sum, o.sum);
        if (s > sim) {
          sim = s;
          best = o;
        }
      }
      this.fold(st, voices, alias, best, c);
    }
  }
}
