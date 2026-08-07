$ErrorActionPreference = "Stop"

$url = "http://localhost:4174"
$workspace = "D:\Project\skill-manager"

function Test-SkillPanel {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

if (-not (Test-SkillPanel)) {
  $server = Join-Path $workspace "server\index.js"
  if (Test-Path -LiteralPath $server) {
    Start-Process -FilePath "node.exe" -ArgumentList @("server\index.js") -WorkingDirectory $workspace -WindowStyle Hidden
    $ready = $false
    for ($i = 0; $i -lt 12; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-SkillPanel) {
        $ready = $true
        break
      }
    }
    if (-not $ready) {
      Write-Warning "Skill manager service did not start automatically. Run npm.cmd run dev in the project folder."
    }
  } else {
    Write-Warning "Skill manager project was not found: $workspace"
  }
}

Start-Process $url
Write-Host "Opened Skill manager: $url"
