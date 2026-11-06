# Canonical paths

Use these paths in docs, scripts, and commands. The spelling is lowercase.

| Item | Path |
| --- | --- |
| Local repo | `/Users/fdp/surveil-me-not` |
| VPS checkout | `/home/deploy/surveil-me-not` |
| GitHub | `https://github.com/fdpitney2000/Surveil-Me-Not/tree/mvp` |
| Branch | `mvp` |
| Compose project | `surveil` |
| Local build | `docker compose -p surveil -f deploy-surveil.yml up -d --build` |
| VPS build | `docker compose -p surveil -f deploy-surveil.yml --profile proxy up -d --build` |

## Case note

macOS is case-insensitive, so `/Users/fdp/Surveil-Me-Not` resolves to the same directory as
`/Users/fdp/surveil-me-not`. The canonical spelling is lowercase. Linux (the VPS) is
case-sensitive; use the lowercase path exactly.

## If the local directory is still capitalized

A case-only rename on macOS needs two steps:

```bash
mv /Users/fdp/Surveil-Me-Not /Users/fdp/surveil-me-not-tmp
mv /Users/fdp/surveil-me-not-tmp /Users/fdp/surveil-me-not
```

Then update shell aliases and IDE workspace paths. The git remote does not change.

## Unrelated directories

`/Users/fdp/librechat2` is an old separate repository; ignore it. The project is the
`Surveil-Me-Not` fork above.
