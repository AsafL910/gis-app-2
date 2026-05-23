{{- define "map-manager-ui.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "map-manager-ui.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "map-manager-ui.name" . -}}
{{- end -}}
{{- end -}}

{{- define "map-manager-ui.labels" -}}
app.kubernetes.io/name: {{ include "map-manager-ui.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "map-manager-ui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "map-manager-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
