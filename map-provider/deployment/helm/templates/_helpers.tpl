{{- define "map-provider.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "map-provider.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "map-provider.name" . -}}
{{- end -}}
{{- end -}}

{{- define "map-provider.labels" -}}
app.kubernetes.io/name: {{ include "map-provider.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "map-provider.selectorLabels" -}}
app.kubernetes.io/name: {{ include "map-provider.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
