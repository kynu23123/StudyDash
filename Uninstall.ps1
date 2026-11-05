param([switch]$Quiet)
$ErrorActionPreference='Stop'
if(!$Quiet){
  Add-Type -AssemblyName System.Windows.Forms
  $answer=[System.Windows.Forms.MessageBox]::Show('Remove StudyDash Dashboard and all its saved tasks, settings, accounts, music preferences and browser data?','Uninstall StudyDash Dashboard',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Question)
  if($answer -ne [System.Windows.Forms.DialogResult]::Yes){exit 0}
}
try {
  if(!$env:LOCALAPPDATA -or !$env:APPDATA){throw 'Windows application folders could not be found.'}
  $programs=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))
  $roaming=[IO.Path]::GetFullPath($env:APPDATA)
  $install=[IO.Path]::GetFullPath((Join-Path $programs 'StudyDash Production'))
  $data=[IO.Path]::GetFullPath((Join-Path $roaming 'StudyDash Production'))
  $browserProfile=[IO.Path]::GetFullPath((Join-Path $roaming 'StudyDash Production Desktop'))
  foreach($target in @($install,$data,$browserProfile)){
    $parent=if($target -eq $install){$programs}else{$roaming}
    if([IO.Path]::GetDirectoryName($target) -ne $parent -or $target -eq $parent){throw 'The uninstall folder is outside its expected location.'}
    if((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'A StudyDash folder is a link. Remove that link manually before uninstalling.'}
  }
  if((Test-Path -LiteralPath $install) -and !(Test-Path -LiteralPath (Join-Path $install 'resources/app/desktop/entry.cjs'))){throw 'The installation folder contains another application.'}
  $exe=Join-Path $install 'StudyDash.exe'
  $processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $exe})
  foreach($process in $processes){Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue}
  $shortcut=Join-Path $roaming 'Microsoft/Windows/Start Menu/Programs/StudyDash Dashboard.lnk'
  if(Test-Path -LiteralPath $shortcut){Remove-Item -LiteralPath $shortcut -Force}
  $startup='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if(!$env:STUDYDASH_TEST){Remove-ItemProperty -Path $startup -Name 'StudyDash Production' -ErrorAction SilentlyContinue}
  foreach($target in @($data,$browserProfile,$install)){
    for($attempt=0;$attempt -lt 6;$attempt++){
      try {if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force};break}
      catch {if($attempt -eq 5){throw};Start-Sleep -Milliseconds 500}
    }
  }
  $registration='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\StudyDashProduction'
  if($env:STUDYDASH_TEST){
    $sha=[System.Security.Cryptography.SHA256]::Create()
    $suffix=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:LOCALAPPDATA)))).Replace('-','').Substring(0,12)
    $registration+='.Test.'+$suffix
    $sha.Dispose()
  }
  if(Test-Path -LiteralPath $registration){Remove-Item -LiteralPath $registration -Force}
  $identity='HKCU:\Software\Classes\AppUserModelId\StudyDash.Production'
  if(!$env:STUDYDASH_TEST -and (Test-Path -LiteralPath $identity)){Remove-Item -LiteralPath $identity -Force}
} catch {
  if(!$Quiet){[System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'StudyDash could not finish uninstalling',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null}
  Write-Error $_
  exit 1
}
