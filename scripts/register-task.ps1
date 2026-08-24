$ErrorActionPreference = 'Continue'
$taskName = 'MES-Local-Ensure'
$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument '-d Ubuntu -e bash /home/overview/mes-local/scripts/mes-watchdog.sh'
$trigger1 = New-ScheduledTaskTrigger -AtLogOn
$trigger2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigger1, $trigger2) -Principal $principal -Description 'Keep MES Local Docker stacks healthy after reboot' | Out-Null
  Write-Output "OK registered $taskName"
  Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State | Format-List
} catch {
  Write-Output "FAIL scheduled task: $($_.Exception.Message)"
  Write-Output 'Create it manually as Administrator if needed.'
}
