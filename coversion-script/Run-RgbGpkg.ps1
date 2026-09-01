[CmdletBinding()]
param(
    [switch]$AutoZoom,
    [int]$MinZoom,
    [int]$MaxZoom,
    [string]$OutputName
)

$ErrorActionPreference = "Stop"
$exitCode = 0

function Get-PixiVersion {
    param([string]$PixiTomlPath)
    $match = Select-String -Path $PixiTomlPath -Pattern '^\s*version\s*=\s*"(.*?)"' | Select-Object -First 1
    if ($match) { return "v$($match.Matches[0].Groups[1].Value)" }
    return "vunknown"
}

$Version = Get-PixiVersion (Join-Path $PSScriptRoot "pixi.toml")

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host $Text -ForegroundColor Cyan
}

try {
    Write-Host "RGB GeoPackage Builder $Version" -ForegroundColor Cyan
    $root = Split-Path -Parent $PSCommandPath
    $python = Join-Path $root "runtime\python.exe"
    $script = Join-Path $root "scripts\convert_rgb_gpkg.py"
    $inputDir = Join-Path $root "input"
    $outputDir = Join-Path $root "output"

    foreach ($dir in @($inputDir, $outputDir)) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir | Out-Null
        }
    }

    $usePixi = $false
    if (-not (Test-Path $python)) {
        $pixiExe = Get-Command pixi -ErrorAction SilentlyContinue
        if ($pixiExe) {
            $usePixi = $true
            Write-Host "Using pixi environment for Python." -ForegroundColor DarkGray
        } else {
            throw "Missing portable runtime: $python (and 'pixi' was not found in your PATH). Either build the portable package or install pixi."
        }
    }

    if (-not (Test-Path $script)) {
        throw "Missing converter script: $script"
    }

    $files = Get-ChildItem -Path $inputDir -File | Where-Object { $_.Extension -in ".tif", ".tiff" } | Sort-Object Name
    if (-not $files) {
        throw "No .tif/.tiff files found in $inputDir. Put a file into the input folder and run this again."
    }

    Write-Section "Available inputs:"
    for ($i = 0; $i -lt $files.Count; $i++) {
        $index = $i + 1
        Write-Host ("  [{0}] {1}" -f $index, $files[$i].Name)
    }

    $choice = Read-Host "Choose a file number"
    $parsedChoice = 0
    if (-not [int]::TryParse($choice, [ref]$parsedChoice)) {
        throw "Please enter a number."
    }

    $selectedIndex = $parsedChoice - 1
    if ($selectedIndex -lt 0 -or $selectedIndex -ge $files.Count) {
        throw "Choice out of range."
    }

    $inputFile = $files[$selectedIndex]
    $defaultOutputName = ($inputFile.BaseName + "_RGB.gpkg")
    if ([string]::IsNullOrWhiteSpace($OutputName)) {
        $outputName = Read-Host "Output file name [$defaultOutputName]"
        if ([string]::IsNullOrWhiteSpace($outputName)) {
            $outputName = $defaultOutputName
        }
    } else {
        $outputName = $OutputName
    }

    if ([System.IO.Path]::GetExtension($outputName) -eq "") {
        $outputName = "$outputName.gpkg"
    }

    $outputFile = Join-Path $outputDir $outputName
    $extraArgs = @()
    if (-not $PSBoundParameters.ContainsKey("AutoZoom") -and -not $PSBoundParameters.ContainsKey("MinZoom") -and -not $PSBoundParameters.ContainsKey("MaxZoom")) {
        Write-Section "Zoom mode:"
        Write-Host "  [1] Automatic max zoom"
        Write-Host "  [2] Manual min/max zoom"
        Write-Host "Press Enter to use automatic zoom."
        $zoomChoice = Read-Host "Choose zoom mode [1]"
        if ([string]::IsNullOrWhiteSpace($zoomChoice)) {
            $zoomChoice = "1"
        }
        if ($zoomChoice -eq "1") {
            $AutoZoom = $true
        } elseif ($zoomChoice -ne "2") {
            throw "Choose 1 for automatic zoom or 2 for manual zoom."
        }
    }

    if ($AutoZoom.IsPresent) {
        $extraArgs += @("--auto-zoom")
    } elseif ($PSBoundParameters.ContainsKey("MinZoom") -and $PSBoundParameters.ContainsKey("MaxZoom")) {
        $minZoomInt = $MinZoom
        $maxZoomInt = $MaxZoom
        if ($minZoomInt -gt $maxZoomInt) {
            throw "Minimum zoom cannot be greater than maximum zoom."
        }
        $extraArgs += @("--min-zoom", "$minZoomInt", "--max-zoom", "$maxZoomInt")
    } else {
        $minZoom = Read-Host "Minimum zoom level"
        $maxZoom = Read-Host "Maximum zoom level"
        $minZoomInt = 0
        $maxZoomInt = 0
        if (-not [int]::TryParse($minZoom, [ref]$minZoomInt)) {
            throw "Minimum zoom must be a number."
        }
        if (-not [int]::TryParse($maxZoom, [ref]$maxZoomInt)) {
            throw "Maximum zoom must be a number."
        }
        if ($minZoomInt -gt $maxZoomInt) {
            throw "Minimum zoom cannot be greater than maximum zoom."
        }
        $extraArgs += @("--min-zoom", "$minZoomInt", "--max-zoom", "$maxZoomInt")
    }

    Write-Host ""
    Write-Host "Processing $($inputFile.Name) -> $([System.IO.Path]::GetFileName($outputFile))" -ForegroundColor Green
    if ($usePixi) {
        & pixi run --manifest-path (Join-Path $root "pixi.toml") python $script $inputFile.FullName $outputFile @extraArgs
    } else {
        & $python $script $inputFile.FullName $outputFile @extraArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Conversion failed."
    }


    Write-Host "Done. Output written to:`n  $outputFile" -ForegroundColor Green
}
catch {
    $exitCode = 1
    Write-Host ""
    Write-Host "Conversion failed:" -ForegroundColor Red
    Write-Host ("  " + $_.Exception.Message) -ForegroundColor Red
    if ($_.InvocationInfo -and $_.InvocationInfo.PositionMessage) {
        Write-Host ""
        Write-Host "Where:" -ForegroundColor DarkYellow
        Write-Host ("  " + $_.InvocationInfo.PositionMessage.Trim())
    }
}
finally {
    Write-Host ""
    Read-Host "Press Enter to close"
    exit $exitCode
}


