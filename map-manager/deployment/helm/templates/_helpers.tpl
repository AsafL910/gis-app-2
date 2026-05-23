{{- define "map-manager.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "map-manager.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "map-manager.name" . -}}
{{- end -}}
{{- end -}}

{{- define "map-manager.labels" -}}
app.kubernetes.io/name: {{ include "map-manager.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "map-manager.selectorLabels" -}}
app.kubernetes.io/name: {{ include "map-manager.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
