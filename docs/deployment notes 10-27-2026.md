Local repo: /Users/fdp/surveil-me-not
VPS repo: /home/deploy/surveil-me-not
Branch: mvp
GitHub remote: https://github.com/fdpitney2000/Surveil-Me-Not
Deployment file: deploy-surveil.yml
Start command:
docker compose -p surveil -f deploy-surveil.yml --profile proxy up -d --build
Public URL: https://surveil-me-not.com
API port: 3080, not directly exposed by UFW
Caddy owns ports 80 and 443
VPS .env is intentionally untracked and must never be committed
VPS Git user: deploy, not root