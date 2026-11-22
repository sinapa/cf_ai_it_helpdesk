# VPN Connected But Internal Sites Fail
category: network

## Symptom
GlobalProtect VPN shows Connected, but internal sites (Jira, GitLab, Confluence) fail to resolve.

## macOS Fix
1. Open Terminal and flush DNS: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`
2. Verify `/etc/resolver/corp.internal` points to `10.10.0.53`.

## Windows Fix
1. Open Command Prompt as Administrator and run `ipconfig /flushdns`.

## Escalation
If `ping 10.10.0.53` times out while VPN is green, escalate to NetOps for a split-tunnel profile reset.
