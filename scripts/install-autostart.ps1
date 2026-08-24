$ErrorActionPreference = 'Continue'

Write-Output '=== HEALTH CHECKS ==='
$urls = @(
  'http://127.0.0.1:3100/api/health',
  'http://192.168.11.87:3100/api/health',
  'http://100.119.139.10:3100/api/health'
)
foreach ($u in $urls) {
  try {
    $r = (Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 5).Content
    Write-Output "$u => $r"
  } catch {
    Write-Output "$u => FAIL $($_.Exception.Message)"
  }
}

Write-Output '=== SCHEDULED TASK ==='
$taskName = 'MES-Local-Ensure'
$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument '-d Ubuntu -e bash /home/overview/mes-local/scripts/mes-watchdog.sh'
$trigger1 = New-ScheduledTaskTrigger -AtLogOn
$trigger2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigger1, $trigger2) -Principal $principal -Description 'Keep MES Local Docker stacks healthy after reboot' | Out-Null
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State | Format-List

Write-Output '=== DOCKER DESKTOP STARTUP ==='
$candidates = @(
  "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
  "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
)
$dd = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $dd) {
  $dd = Get-ChildItem -Path "$env:ProgramFiles\Docker", "$env:LOCALAPPDATA" -Filter 'Docker Desktop.exe' -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if ($dd) {
  Write-Output "Found: $dd"
  $startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Docker Desktop.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($startup)
  $lnk.TargetPath = $dd
  $lnk.Save()
  Write-Output "Startup shortcut: $startup"
} else {
  Write-Output 'Docker Desktop.exe not found'
}
