{{- define "example-client.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "example-client.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "example-client.name" . -}}
{{- end -}}
{{- end -}}

{{- define "example-client.labels" -}}
app.kubernetes.io/name: {{ include "example-client.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "example-client.selectorLabels" -}}
app.kubernetes.io/name: {{ include "example-client.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
