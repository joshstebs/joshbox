# Run this yourself in PowerShell. The secret is never printed or sent to chat.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$secretDir=Join-Path $env:LOCALAPPDATA 'JoshBox'
$secretFile=Join-Path $secretDir 'hf-token.clixml'
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
$secureToken=Read-Host 'Paste your NEW repo-scoped HF token (hidden)' -AsSecureString
if($secureToken.Length -eq 0){throw 'No token was entered.'}
$credential=[System.Management.Automation.PSCredential]::new('HF_TOKEN',$secureToken)
# Export-Clixml uses Windows DPAPI: only this Windows user on this machine can decrypt it.
$credential | Export-Clixml -LiteralPath $secretFile
$acl=Get-Acl -LiteralPath $secretFile
$acl.SetAccessRuleProtection($true,$false)
$userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$rule=[Security.AccessControl.FileSystemAccessRule]::new($userSid,'FullControl','Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $secretFile -AclObject $acl
$secureToken.Dispose()
Write-Output 'HF token saved with Windows encryption and restricted file access. The token was not printed.'
