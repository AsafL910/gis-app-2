$Version = "v0.2.0"
[CmdletBinding()]
param(
    [switch]$AutoZoom,
    [int]$MinZoom,
    [int]$MaxZoom,
    [string]$OutputName
)

$ErrorActionPreference = "Stop"
$exitCode = 0

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host $Text -ForegroundColor Cyan
}

function Write-Stage {
    param(
        [string]$Activity,
        [string]$Status,
        [int]$PercentComplete
    )

    Write-Progress -Activity $Activity -Status $Status -PercentComplete $PercentComplete
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

    Write-Stage -Activity "RGB GeoPackage Builder" -Status "Selecting input" -PercentComplete 5
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
    Write-Stage -Activity "RGB GeoPackage Builder" -Status "Input selected: $($inputFile.Name)" -PercentComplete 10

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
    Write-Stage -Activity "RGB GeoPackage Builder" -Status "Writing to $([System.IO.Path]::GetFileName($outputFile))" -PercentComplete 20

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
        Write-Stage -Activity "RGB GeoPackage Builder" -Status "Auto zoom selected" -PercentComplete 25
        $extraArgs += @("--auto-zoom")
    } elseif ($PSBoundParameters.ContainsKey("MinZoom") -and $PSBoundParameters.ContainsKey("MaxZoom")) {
        $minZoomInt = $MinZoom
        $maxZoomInt = $MaxZoom
        if ($minZoomInt -gt $maxZoomInt) {
            throw "Minimum zoom cannot be greater than maximum zoom."
        }
        Write-Stage -Activity "RGB GeoPackage Builder" -Status "Manual zooms $minZoomInt..$maxZoomInt" -PercentComplete 25
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
        Write-Stage -Activity "RGB GeoPackage Builder" -Status "Manual zooms $minZoomInt..$maxZoomInt" -PercentComplete 25
        $extraArgs += @("--min-zoom", "$minZoomInt", "--max-zoom", "$maxZoomInt")
    }

    Write-Host ""
    Write-Host "Processing $($inputFile.Name) -> $([System.IO.Path]::GetFileName($outputFile))" -ForegroundColor Green
    Write-Stage -Activity "RGB GeoPackage Builder" -Status "Launching converter" -PercentComplete 30
    if ($usePixi) {
        & pixi run --manifest-path (Join-Path $root "pixi.toml") python $script $inputFile.FullName $outputFile @extraArgs
    } else {
        & $python $script $inputFile.FullName $outputFile @extraArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Conversion failed."
    }



    Write-Progress -Activity "RGB GeoPackage Builder" -Completed
    Write-Host "Done. Output written to:`n  $outputFile" -ForegroundColor Green
}
catch {
    $exitCode = 1
    Write-Progress -Activity "RGB GeoPackage Builder" -Completed
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


