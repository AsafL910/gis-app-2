# OpenShift Helm Deployment

Each service owns its Helm chart inside its own directory:

- `map-manager/deployment/helm`
- `terrain-calculator/deployment/helm`
- `map-manager-ui/deployment/helm`
- `map-provider/deployment/helm`
- `hat-provider/deployment/helm`
- `example-client/deployment/helm`

Every service chart contains separate OpenShift/Kubernetes manifest templates:

- `templates/deployment.yaml`
- `templates/service.yaml`
- `templates/route.yaml`

Shared deployment-time configuration lives at the repo level:

- `deployment/shared-pvc.yaml`
- `deployment/values/shared.yaml`
- `deployment/values/*.yaml`

## Shared PVC

The GIS services that read or write `data/` mount the same PVC at `/app/data`.

Services using the shared PVC:

- `map-manager`
- `terrain-calculator`
- `map-provider`
- `hat-provider`

The PVC manifest defaults to `ReadWriteMany`, which is usually the right fit for OpenShift when multiple pods need the same data volume.
If your storage class does not support RWX, adjust the manifest before applying it.

## Suggested install flow

1. Create or select your OpenShift project.
2. Apply the shared PVC.
3. Install each chart with the shared values file plus the service-specific values file.

Example:

```powershell
oc new-project your-project
oc apply -f deployment/shared-pvc.yaml

helm upgrade --install map-manager .\map-manager\deployment\helm -f .\deployment\values\shared.yaml -f .\deployment\values\map-manager.yaml
helm upgrade --install terrain-calculator .\terrain-calculator\deployment\helm -f .\deployment\values\shared.yaml -f .\deployment\values\terrain-calculator.yaml
helm upgrade --install map-manager-ui .\map-manager-ui\deployment\helm -f .\deployment\values\shared.yaml -f .\deployment\values\map-manager-ui.yaml
helm upgrade --install map-provider .\map-provider\deployment\helm -f .\deployment\values\shared.yaml -f .\deployment\values\map-provider.yaml
helm upgrade --install hat-provider .\hat-provider\deployment\helm -f .\deployment\values\shared.yaml -f .\deployment\values\hat-provider.yaml
helm upgrade --install example-client .\example-client\deployment\helm -f .\deployment\values\shared.yaml -f .\deployment\values\example-client.yaml
```

## Image configuration

Each service values file under `deployment/values/` points at a placeholder OpenShift internal registry path:

`image-registry.openshift-image-registry.svc:5000/your-project/<service>:latest`

Update `your-project` and tags as needed for your cluster.

## Routes

Every chart has a dedicated `templates/route.yaml` manifest.
The `route.enabled` value only controls whether that separate Route manifest is rendered during Helm install or upgrade.
The repo-level service values currently enable routes for all services.
Leave `route.host` empty to let OpenShift generate a hostname, or set a custom host in the service values file.
