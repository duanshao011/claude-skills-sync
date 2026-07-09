$ErrorActionPreference = "Stop"

$url = "http://localhost:3000"
$workspace = Join-Path $PSScriptRoot "..\app"

function Test-InfoSource {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

if (-not (Test-InfoSource)) {
  $serverJs = Join-Path $workspace "server.js"
  if (Test-Path -LiteralPath $serverJs) {
    # Check if node_modules exists
    $nodeModules = Join-Path $workspace "node_modules"
    if (-not (Test-Path -LiteralPath $nodeModules)) {
      Write-Host "Installing dependencies..."
      $proc = Start-Process -FilePath "npm.cmd" -ArgumentList @("install") -WorkingDirectory $workspace -Wait -NoNewWindow -PassThru
      if ($proc.ExitCode -ne 0) {
        Write-Warning "npm install failed. Run 'npm install' manually in: $workspace"
        exit 1
      }
    }

    $env:NO_AUTO_OPEN = "1"
    Start-Process -FilePath "node.exe" -ArgumentList @("server.js") -WorkingDirectory $workspace -WindowStyle Hidden

    $ready = $false
    for ($i = 0; $i -lt 15; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-InfoSource) {
        $ready = $true
        break
      }
    }
    if (-not $ready) {
      Write-Warning "Service didn't start in time. Run 'npm start' in: $workspace"
    }
  } else {
    Write-Warning "App not found: $workspace"
  }
}

Start-Process $url
Write-Host "信息源监控已打开: $url"
