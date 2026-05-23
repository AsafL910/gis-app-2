{{- define "terrain-calculator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "terrain-calculator.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "terrain-calculator.name" . -}}
{{- end -}}
{{- end -}}

{{- define "terrain-calculator.labels" -}}
app.kubernetes.io/name: {{ include "terrain-calculator.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "terrain-calculator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "terrain-calculator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
