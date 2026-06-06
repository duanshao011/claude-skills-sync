$ErrorActionPreference = "Stop"

$url = "http://localhost:4174"
$workspaceName = "Skill" + [char]0x7BA1 + [char]0x7406 + [char]0x5668
$workspace = [System.IO.Path]::Combine($env:USERPROFILE, "Documents", $workspaceName)

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
