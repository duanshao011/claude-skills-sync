$ErrorActionPreference = "Stop"

$appDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\app"))
$envFile = Join-Path $appDirectory ".env"
$pidFile = Join-Path $appDirectory ".zhunxing.pid"

function Get-DotEnvSetting {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*#' -or $line -notmatch '=') {
      continue
    }

    $parts = $line -split '=', 2
    if ($parts[0].Trim() -ne $Name) {
      continue
    }

    $value = $parts[1].Trim()
    if ($value.Length -ge 2) {
      $first = $value.Substring(0, 1)
      $last = $value.Substring($value.Length - 1, 1)
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    return $value
  }

  return $null
}

function Get-ZhunxingUri {
  param(
    [string]$HostName,
    [int]$Port,
    [string]$Path
  )

  $clientHost = $HostName
  if ($clientHost -eq "[::1]") {
    $clientHost = "::1"
  }

  $builder = New-Object System.UriBuilder("http", $clientHost, $Port, $Path)
  return $builder.Uri.AbsoluteUri
}

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host "准星没有已记录的运行进程。"
  exit 0
}

$pidText = [System.IO.File]::ReadAllText($pidFile).Trim()
$recordedPid = 0
if (-not [int]::TryParse($pidText, [ref]$recordedPid) -or $recordedPid -le 0) {
  Write-Warning "准星 PID 文件无效，未停止任何进程：$pidFile"
  exit 1
}

$hostName = "127.0.0.1"
$portText = Get-DotEnvSetting -Path $envFile -Name "PORT"
$port = 3000
if (-not [string]::IsNullOrWhiteSpace($portText)) {
  $parsedPort = 0
  if (-not [int]::TryParse($portText, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
    Write-Warning "app/.env 中的 PORT 无效，未停止任何进程。"
    exit 1
  }
  $port = $parsedPort
}

$process = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
if ($null -eq $process) {
  Remove-Item -LiteralPath $pidFile -Force
  Write-Host "记录的准星进程已不存在，已清理 PID 文件。"
  exit 0
}

$healthUri = Get-ZhunxingUri -HostName $hostName -Port $port -Path "/api/health"
try {
  $health = Invoke-RestMethod -Uri $healthUri -Method Get -TimeoutSec 2 -UseBasicParsing
} catch {
  Write-Warning "无法验证准星健康接口，未停止 PID $recordedPid。"
  exit 1
}

$healthPid = 0
if ($health.app -ne "zhunxing" -or -not [int]::TryParse([string]$health.pid, [ref]$healthPid) -or $healthPid -ne $recordedPid) {
  Write-Warning "PID 文件与准星健康接口不匹配，未停止任何进程。"
  exit 1
}

Stop-Process -Id $recordedPid -ErrorAction Stop
Remove-Item -LiteralPath $pidFile -Force
Write-Host "准星已停止（PID $recordedPid）。"
