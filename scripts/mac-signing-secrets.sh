#!/bin/zsh
# Signature Developer ID + notarisation des versions Mac (CI) : enregistre les secrets GitHub.
# 1. Trousseau d'accès › Mes certificats › « Developer ID Application: … » › clic droit › Exporter (.p12)
# 2. Mot de passe pour app : appleid.apple.com › Connexion et sécurité › Mots de passe pour app
# 3. zsh scripts/mac-signing-secrets.sh ~/Desktop/Certificats.p12
# Rien n'est affiché ni écrit sur le disque : chaque valeur part directement dans `gh secret set`.
set -euo pipefail
P12=${1:?usage : zsh scripts/mac-signing-secrets.sh <certificat.p12>}
R=adrbn/minute

base64 -i "$P12" | gh secret set MAC_CERT_P12_BASE64 -R $R
read -rs "v?Mot de passe du .p12 : "; echo
print -rn -- "$v" | gh secret set MAC_CERT_PASSWORD -R $R
read -r "v?Identifiant Apple (e-mail du compte développeur) : "
print -rn -- "$v" | gh secret set APPLE_ID -R $R
read -rs "v?Mot de passe pour app (xxxx-xxxx-xxxx-xxxx) : "; echo
print -rn -- "$v" | gh secret set APPLE_APP_SPECIFIC_PASSWORD -R $R
print -n 2TWQF4T93E | gh secret set APPLE_TEAM_ID -R $R
unset v
gh secret list -R $R
