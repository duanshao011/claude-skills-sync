$ErrorActionPreference = "Stop"

$appDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\app"))
$envFile = Join-Path $appDirectory ".env"
$pidFile = Join-Path $appDirectory ".zhunxing.pid"
$logDirectory = Join-Path $appDirectory "logs"
$stdoutLog = Join-Path $logDirectory "zhunxing.stdout.log"
$stderrLog = Join-Path $logDirectory "zhunxing.stderr.log"
$managedNode = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".workbuddy\binaries\node\versions\22.22.2\node.exe"))
$managedNpmCli = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".workbuddy\binaries\node\versions\22.22.2\node_modules\npm\bin\npm-cli.js"))

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
    [string]$Path = "/"
  )

  $clientHost = $HostName
  if ($clientHost -eq "[::1]") {
    $clientHost = "::1"
  }

  $builder = New-Object System.UriBuilder("http", $clientHost, $Port, $Path)
  return $builder.Uri.AbsoluteUri
}

function Get-ZhunxingHealth {
  param([string]$Uri)

  try {
    $health = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 2 -UseBasicParsing
    if ($health.app -eq "zhunxing") {
      return $health
    }
  } catch {
    return $null
  }

  return $null
}

$hostName = "127.0.0.1"
$portText = Get-DotEnvSetting -Path $envFile -Name "PORT"
$port = 3000
if (-not [string]::IsNullOrWhiteSpace($portText)) {
  $parsedPort = 0
  if (-not [int]::TryParse($portText, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
    throw "app/.env 中的 PORT 必须是 1 到 65535 之间的整数。"
  }
  $port = $parsedPort
}

$pageUri = Get-ZhunxingUri -HostName $hostName -Port $port
$healthUri = Get-ZhunxingUri -HostName $hostName -Port $port -Path "/api/health"
$fetchUri = Get-ZhunxingUri -HostName $hostName -Port $port -Path "/api/fetch"

try {
  $health = Get-ZhunxingHealth -Uri $healthUri
  if ($null -eq $health) {
    if (-not (Test-Path -LiteralPath $managedNode)) {
      throw "未找到 WorkBuddy 隔离托管 Node.js 22.22.2：$managedNode"
    }
    if (-not (Test-Path -LiteralPath $managedNpmCli)) {
      throw "未找到 WorkBuddy 隔离托管 npm CLI：$managedNpmCli"
    }

    $nodeModules = Join-Path $appDirectory "node_modules"
    if (-not (Test-Path -LiteralPath $nodeModules)) {
      $installCommand = "install"
      if (Test-Path -LiteralPath (Join-Path $appDirectory "package-lock.json")) {
        $installCommand = "ci"
      }

      Write-Host "正在安装准星依赖..."
      $install = Start-Process -FilePath $managedNode -ArgumentList @($managedNpmCli, $installCommand, "--no-audit", "--no-fund") -WorkingDirectory $appDirectory -Wait -NoNewWindow -PassThru
      if ($install.ExitCode -ne 0) {
        throw "依赖安装失败（退出码 $($install.ExitCode)）。"
      }
    }

    if (-not (Test-Path -LiteralPath $logDirectory)) {
      New-Item -ItemType Directory -Path $logDirectory | Out-Null
    }

    $serverScript = Join-Path $appDirectory "server.js"
    if (-not (Test-Path -LiteralPath $serverScript)) {
      throw "未找到准星服务入口：$serverScript"
    }

    $process = Start-Process -FilePath $managedNode -ArgumentList @($serverScript) -WorkingDirectory $appDirectory -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
    [System.IO.File]::WriteAllText($pidFile, [string]$process.Id)

    $health = $null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      Start-Sleep -Milliseconds 500
      $health = Get-ZhunxingHealth -Uri $healthUri
      if ($null -ne $health) {
        break
      }
      if ($process.HasExited) {
        break
      }
    }

    if ($null -eq $health) {
      Write-Warning "准星服务未通过健康检查，请查看 $stderrLog"
    } elseif ([int64]$health.pid -ne [int64]$process.Id) {
      Write-Warning "健康接口 PID 与新启动进程不一致，已保留启动 PID 供排查。"
    }
  } elseif ($null -ne $health.pid) {
    [System.IO.File]::WriteAllText($pidFile, [string]$health.pid)
  }

  if ($null -ne $health) {
    try {
      $body = ConvertTo-Json @{ trigger = "skill-open" } -Compress
      Invoke-RestMethod -Uri $fetchUri -Method Post -ContentType "application/json" -Body $body -TimeoutSec 120 -UseBasicParsing | Out-Null
    } catch {
      Write-Warning "本次内容更新失败，仍将打开已有内容：$($_.Exception.Message)"
    }
  }
} catch {
  Write-Warning $_.Exception.Message
} finally {
  Start-Process $pageUri
  Write-Host "准星已打开：$pageUri"
}
