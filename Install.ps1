param([int]$Port=47322)
$ErrorActionPreference='Stop'
$package=$PSScriptRoot
$install=Join-Path $env:LOCALAPPDATA 'Programs/StudyDash Production'
$exe=Join-Path $install 'StudyDash.exe'
if(!(Test-Path -LiteralPath (Join-Path $package 'resources/app/desktop/entry.cjs'))){throw 'Extract the entire ZIP before installing.'}
$version=(Get-Content -LiteralPath (Join-Path $package 'resources/app/package.json') -Raw | ConvertFrom-Json).version
try {$status=Invoke-RestMethod "http://127.0.0.1:$Port/api/desktop/status" -TimeoutSec 2} catch {$status=$null}
if($status){
  $expected=[System.IO.Path]::GetFullPath((Join-Path $install 'resources/app'))
  if($status.app -ne 'StudyDash' -or [System.IO.Path]::GetFullPath($status.root) -ne $expected){throw 'Close the other StudyDash production copy from its tray menu, then install again.'}
  Invoke-RestMethod "http://127.0.0.1:$Port/api/quit" -Method Post -TimeoutSec 3 | Out-Null
  Start-Sleep -Seconds 5
}
if((Test-Path -LiteralPath $install) -and !(Test-Path -LiteralPath (Join-Path $install 'resources/app/desktop/entry.cjs'))){throw 'The installation folder contains another application.'}
New-Item -ItemType Directory -Path $install -Force | Out-Null
Get-ChildItem -LiteralPath $package | Where-Object {$_.Name -notin @('Install.cmd','Install.ps1')} | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $install -Recurse -Force}
$programs=Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'
New-Item -ItemType Directory -Path $programs -Force | Out-Null
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut((Join-Path $programs 'StudyDash Dashboard.lnk'))
$shortcut.TargetPath=$exe
$shortcut.WorkingDirectory=$install
$shortcut.Description='StudyDash - #1 Dashboard'
$shortcut.IconLocation="$exe,0"
$shortcut.Save()
$registration='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\StudyDashProduction'
if($env:STUDYDASH_TEST){
  $sha=[System.Security.Cryptography.SHA256]::Create()
  $suffix=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:LOCALAPPDATA)))).Replace('-','').Substring(0,12)
  $registration+='.Test.'+$suffix
  $sha.Dispose()
}
New-Item -Path $registration -Force | Out-Null
$uninstall='"'+(Join-Path $PSHOME 'powershell.exe')+'" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $install 'Uninstall.ps1')+'"'
$values=@{DisplayName='StudyDash Dashboard';DisplayVersion=$version;Publisher='StudyDash';InstallLocation=$install;DisplayIcon="$exe,0";UninstallString=$uninstall;QuietUninstallString=($uninstall+' -Quiet');InstallDate=(Get-Date -Format 'yyyyMMdd')}
foreach($name in $values.Keys){New-ItemProperty -Path $registration -Name $name -Value $values[$name] -PropertyType String -Force | Out-Null}
foreach($name in @('NoModify','NoRepair')){New-ItemProperty -Path $registration -Name $name -Value 1 -PropertyType DWord -Force | Out-Null}
$size=[int][Math]::Ceiling((Get-ChildItem -LiteralPath $install -Recurse -File | Measure-Object Length -Sum).Sum/1024)
New-ItemProperty -Path $registration -Name EstimatedSize -Value $size -PropertyType DWord -Force | Out-Null
Set-Content -LiteralPath (Join-Path $install 'install-version.txt') -Value $version -Encoding ASCII
Write-Host 'Installed. Open StudyDash Dashboard from the Start menu.'
