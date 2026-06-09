# Offline images

This folder contains the Docker image tarballs for the offline station:

- `map-manager-alpha.tar`
- `terrain-calculator-alpha.tar`
- `map-manager-ui-alpha.tar`
- `map-provider-alpha.tar`
- `hat-provider-alpha.tar`
- `example-client-alpha.tar`

Load them with:

```powershell
Get-ChildItem .\docker-images\*.tar | ForEach-Object { docker load -i $_.FullName }
```

Then start the stack with:

```powershell
docker compose -f docker-compose.offline.yml up
```
