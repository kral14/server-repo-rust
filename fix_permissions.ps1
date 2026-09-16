$keys = @(
    "e:\mezuniyyet-rust-taurisiz-olan\server-repo-rust\ssh-key-MasterDeploy.key",
    "e:\mezuniyyet-rust-taurisiz-olan\server-repo-rust\ssh-key-132.key"
)

foreach ($k in $keys) {
    if (Test-Path $k) {
        $acl = Get-Acl $k
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, "FullControl", "Allow")
        $acl.SetAccessRule($rule)
        Set-Acl $k $acl
        Write-Host "Qorundu (Chmod 600): $k"
    }
}
