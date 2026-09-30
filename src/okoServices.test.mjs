// src/okoServices.test.mjs — služby Windows namiesto úloh pri prihlásení (2026-09-29, vlastník:
// „potrebujem aj dobre nastaviť samotný server na PC, aby sa spúšťal s Windows a nepadal").
// Tripwires na scripts/install-oko-services.ps1 (NSSM: štart s Windows, bez okna, reštart po páde,
// Normal priorita, log s rotáciou) a na vetvu so službami v scripts/oko-publish.ps1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const install = read('../scripts/install-oko-services.ps1');
const publish = read('../scripts/oko-publish.ps1');

test('inštalácia: UTF-8 s BOM, len ASCII (PowerShell 5.1), len zo zvýšeného PowerShellu', () => {
  const bytes = readFileSync(new URL('../scripts/install-oko-services.ps1', import.meta.url));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'chýba BOM');
  assert.doesNotMatch(install.replace(/^\uFEFF/, ''), /[^\x00-\x7F]/, 'diakritika v skripte pre PowerShell 5.1');
  assert.match(install, /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
  assert.match(install, /if \(-not \$isAdmin\) \{ throw/);
});

test('tri služby: štart s Windows (dev server oneskorene), Normal priorita, reštart 5 s po každom konci, strom procesov', () => {
  assert.match(install, /Set-OkoService -Name 'oko-static' -Display 'OKO public static' -Start 'SERVICE_AUTO_START'/);
  assert.match(install, /Set-OkoService -Name 'oko-tunnel' -Display 'OKO Cloudflare Tunnel' -Start 'SERVICE_AUTO_START'/);
  assert.match(install, /Set-OkoService -Name 'oko-dev' -Display 'OKO dev server' -Start 'SERVICE_DELAYED_AUTO_START'/);
  for (const setting of [
    "'AppPriority', 'NORMAL_PRIORITY_CLASS'",
    "'AppExit', 'Default', 'Restart'",
    "'AppRestartDelay', '5000'",
    "'AppRotateFiles', '1'",
    "'AppRotateOnline', '1'",
    "'AppRotateBytes', '10485760'",
    "'ObjectName', 'LocalSystem'",
  ]) assert.ok(install.includes(setting), `chýba nastavenie NSSM ${setting}`);
  assert.match(install, /sc\.exe failure \$Name reset= 86400 actions= restart\/10000\/restart\/10000\/restart\/60000/, 'poistka, keby padol samotný nssm.exe');
  // NSSM 2.24 na tomto stroji parameter AppKillProcessTree nepozná (inštalácia 09-29 na ňom spadla);
  // strom procesov pri zastavení zabíja sám („Killing process tree of process …" v logu udalostí).
  assert.doesNotMatch(install, /Invoke-Nssm @\('set', \$Name, 'AppKillProcessTree'/);
});

test('dev server beží cez strážcu (pád aj zaseknutie), tunel so svojou konfiguráciou, statický server s rovnakými argumentmi ako pri publikovaní', () => {
  assert.match(install, /-App \$Node `\s*\n\s*-AppArgs "\$devSupervisor --port \$DevPort"/);
  assert.match(install, /-AppArgs "tunnel --config \$TunnelConfig run \$TunnelName"/);
  assert.match(install, /-AppArgs "\$staticServer --port \$StaticPort --dir dist\$redirectArgs"/);
  assert.match(publish, /\$staticArgs = "\$serverScript --port \$StaticPort --dir dist\$redirectArgs"/, 'publikovanie porovnáva ten istý tvar argumentov');
  assert.match(install, /\[string\[\]\]\$Redirects = @\('www\.okolive\.sk=https:\/\/okolive\.sk'\)/, 'rovnaké presmerovanie ako predvolené v oko-publish.ps1');
  assert.match(publish, /\[string\[\]\]\$Redirects = @\('www\.okolive\.sk=https:\/\/okolive\.sk'\)/);
});

test('bezpečnosť ciest a prechod z úloh: systémové cesty, úlohy len vypnuté, končia sa len naše procesy', () => {
  assert.match(install, /\[string\]\$Node = 'C:\\Program Files\\nodejs\\node\.exe'/, 'systémový Node, nie fnm v AppData');
  assert.match(install, /if \(\$p -match '\\\\AppData\\\\'\) \{ throw/, 'cesta v profile používateľa do služby nepatrí (MSIX presmerovanie)');
  assert.match(install, /Disable-ScheduledTask -TaskName \$task/);
  assert.doesNotMatch(install, /Unregister-ScheduledTask/, 'úlohy ostávajú na návrat (-Uninstall)');
  assert.match(install, /Stop-OkoPortOwner -Port \$DevPort -Pattern 'vite'/);
  assert.match(install, /Stop-OkoPortOwner -Port \$StaticPort -Pattern 'oko-static-server'/);
  assert.match(install, /throw "port \$Port is used by another program/, 'cudzí proces na porte sa nezabíja');
  assert.match(install, /\$proc\.CommandLine -match 'config-oko\\\.yml'/, 'z cloudflared len tunel oko, nie ostatné tunely stroja');
  assert.match(install, /if \(\$Uninstall\) \{[\s\S]*?Invoke-Nssm @\('remove', \$name, 'confirm'\)[\s\S]*?Enable-ScheduledTask -TaskName \$task/);
});

test('publikovanie so službami: statický server bez reštartu pri novom builde, tunel len pri zmene ingressu', () => {
  assert.match(publish, /\$staticService = Get-Service -Name 'oko-static' -ErrorAction SilentlyContinue/);
  assert.match(publish, /HKLM:\\SYSTEM\\CurrentControlSet\\Services\\oko-static\\Parameters/);
  assert.match(publish, /if \(\$current -ne \$staticArgs\) \{[\s\S]*?Restart-Service -Name 'oko-static'/);
  // nový kód servera (robots.txt, hlavičky) sa bez reštartu procesu neprejaví (2026-09-30)
  assert.match(publish, /\$codeNewer = \$staticProc -and \(\(Get-Item -LiteralPath \$serverScript\)\.LastWriteTime -gt \$staticProc\.CreationDate\)/);
  assert.match(publish, /\} elseif \(\$codeNewer\) \{\s*\n\s*Restart-Service -Name 'oko-static'/);
  assert.match(publish, /if \(\[System\.IO\.File\]::ReadAllText\(\$config\) -ceq \$newConfig\) \{\s*\n\s*Write-Host 'ingress unchanged: the tunnel keeps running'/);
  assert.match(publish, /if \(\$tunnelService\) \{\s*\n\s*Restart-Service -Name 'oko-tunnel'/);
  // bez služieb ostáva pôvodná cesta cez úlohy Plánovača (s Normal prioritou)
  assert.match(publish, /Register-ScheduledTask -TaskName \$StaticTaskName/);
  assert.match(publish, /Start-ScheduledTask -TaskName \$TunnelTaskName/);
});

test('práva na službu: používateľ, ktorý inštaluje, smie štart/stop/stav (publikovanie bez zvýšených práv)', () => {
  assert.match(install, /\$ace = "\(A;;CCLCSWRPWPLORC;;;\$sid\)"/);
  assert.match(install, /& sc\.exe sdset \$Name \$new/);
});
