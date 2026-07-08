# Cyber Threat Keyword Classification Standard

## Purpose

This document defines how cyber threat keywords should be categorized in the cheap-filter stage of the threat monitoring pipeline.

The cheap filter should not decide whether an article is definitely relevant. It should decide whether the article is worth fetching and extracting.

The keyword categories are used to support this flow:

```text
NEW
  ↓
cheap filter on RSS metadata
  ↓
KEEP / MAYBE_KEEP / DROP
  ↓
extract body for KEEP and MAYBE_KEEP
  ↓
entity extraction on full body
  ↓
second-stage relevance gate
```

---

# 1. Core Principle

Keywords should be categorized by **operational actionability**, not by how technical or scary the word sounds.

Use this standard:

```text
Critical keyword = suggests immediate exploitation, breach, urgent patching, or incident response
Medium keyword   = suggests security relevance, but needs more evidence
Low keyword      = weak security context, useful only when combined with stronger signals
Negative keyword = likely business, marketing, or non-threat context
```

The cheap filter should answer:

```text
Is this article worth fetching?
```

It should not answer:

```text
Is this article definitely relevant?
```

---

# 2. Keyword Categories

## 2.1 Critical Keywords

A keyword or phrase should be classified as **Critical** if it strongly implies one of the following:

```text
1. Active exploitation is happening
2. A real breach, compromise, or data leak occurred
3. Remote unauthenticated impact is possible
4. Emergency patching or mitigation is required
5. Ransomware or malware campaign is active
6. Exploit is weaponized or used in the wild
```

Default cheap-filter behaviour:

```text
Critical keyword found → KEEP → EXTRACTION_PENDING
```

Critical keywords should strongly push the article to extraction, especially if the article is recent or from a trusted source.

---

## 2.2 Medium Keywords

A keyword or phrase should be classified as **Medium** if it indicates security relevance but does not prove urgency by itself.

Medium keywords usually mean:

```text
This article is probably security-related, but extraction and entity analysis are needed before alerting.
```

Default cheap-filter behaviour:

```text
Medium keyword only → MAYBE_KEEP
Medium keyword + vendor/product/source tier/CVE → KEEP
```

Medium keywords should usually trigger extraction only if combined with another signal, such as a monitored vendor, product, trusted security source, CVE, or security-related RSS category.

---

## 2.3 Low Keywords

A keyword should be classified as **Low** if it provides weak security context and is too noisy on its own.

Default cheap-filter behaviour:

```text
Low keyword only → do not extract by itself
Low keyword + other weak signals → MAYBE_KEEP
Low keyword + strong signal → score boost
```

Low keywords should only be used as supporting evidence.

---

## 2.4 Negative Keywords

A keyword or phrase should be classified as **Negative** if it suggests the article is likely about business, marketing, product announcements, finance, hiring, or other non-threat topics.

Default cheap-filter behaviour:

```text
Negative keyword → reduce score
Negative keyword + no strong positive signal → DROP
Negative keyword + strong positive signal → do not automatically drop
```

Negative keywords should reduce confidence, but should not always hard-drop an article because some real incidents appear in business or regulatory contexts.

---

# 3. Recommended Scoring

Use keyword category as part of a broader score.

```text
Critical keyword: +35
Medium keyword:   +20
Low keyword:      +5
Negative keyword: -20
```

Combine keyword score with other signals:

```text
CVE found:                 +50
Monitored product found:   +65
Monitored vendor found:    +50
Official vendor source:    +25
Government/CERT source:    +25
Security media source:     +10
Researcher blog source:    +10
Security RSS category:     +10
Article published <24h:    +10
Old article/stale repost:  -20
```

The final cheap-filter score is normalized to a 0–100 range before it is
stored, displayed, or compared with thresholds.

Suggested decision thresholds:

```text
score >= 40  → KEEP
score 15–39  → MAYBE_KEEP
score < 15   → DROP
```

---

# 4. Critical Keyword List

## 4.1 Active Exploitation Signals

```text
actively exploited
active exploitation
exploited in the wild
exploitation in the wild
exploitation observed
observed exploitation
under active attack
mass exploitation
widespread exploitation
weaponized exploit
weaponised exploit
known exploited vulnerability
known exploited vulnerabilities
CISA KEV
added to KEV
KEV catalog
known exploited vulnerabilities catalog
in-the-wild attacks
attacks in the wild
real-world attacks
exploitation attempts
```

## 4.2 Zero-Day and Emergency Signals

```text
zero-day
0-day
zero day
zero-day vulnerability
zero-day exploit
emergency patch
emergency update
out-of-band patch
out of band patch
urgent patch
immediate mitigation
temporary mitigation
workaround released
mitigation released
hotfix
security hotfix
```

## 4.3 High-Impact Vulnerability Signals

```text
remote code execution
RCE
pre-auth RCE
pre-authentication RCE
unauthenticated RCE
unauthenticated remote code execution
authentication bypass
auth bypass
authorization bypass
privilege escalation
privilege-escalation
local privilege escalation
LPE
sandbox escape
arbitrary code execution
command injection
arbitrary file upload
arbitrary file read
arbitrary file write
account takeover
ATO
session takeover
token theft
```

## 4.4 Incident, Breach, and Compromise Signals

```text
breach
data breach
security breach
data leak
leaked data
data exposure
compromise
compromised
system compromise
account compromise
credential theft
stolen credentials
password dump
backdoor
supply chain attack
ransomware attack
extortion
double extortion
intrusion
unauthorized access
unauthorised access
```

## 4.5 Malware and Campaign Signals

```text
ransomware
wiper malware
destructive malware
botnet outbreak
malware campaign
active malware campaign
infostealer campaign
stealer campaign
backdoor deployed
malware deployed
C2 infrastructure
command and control infrastructure
```

---

# 5. Medium Keyword List

## 5.1 Vulnerability and Patch Signals

```text
vulnerability
security vulnerability
critical vulnerability
critical flaw
flaw
bug
security bug
weakness
patch
security patch
security update
advisory
security advisory
disclosure
responsible disclosure
CVE reserved
CVSS
CVSS 9
CVSS 10
severity score
affected versions
fixed versions
```

## 5.2 Exploit Development Signals

```text
exploit
exploit code
PoC
proof of concept
proof-of-concept
public exploit
public PoC
GitHub PoC
Metasploit module
technical details released
exploit released
exploit available
weaponization possible
```

Note:

```text
Public PoC or exploit code does not automatically mean active exploitation.
It should usually be treated as Medium unless paired with active exploitation wording.
```

## 5.3 Malware and Threat Actor Signals

```text
malware
trojan
loader
infostealer
information stealer
stealer
botnet
worm
spyware
keylogger
C2
command and control
threat actor
APT
advanced persistent threat
campaign
malicious campaign
IOC
IOCs
indicator of compromise
indicators of compromise
TTP
TTPs
MITRE ATT&CK
phishing
phishing campaign
spear phishing
business email compromise
BEC
```

## 5.4 Common Vulnerability Classes

```text
SQL injection
SQLi
XSS
cross-site scripting
SSRF
server-side request forgery
CSRF
path traversal
directory traversal
deserialization
insecure deserialization
XXE
open redirect
information disclosure
denial of service
DoS
DDoS
memory corruption
buffer overflow
heap overflow
stack overflow
use-after-free
UAF
race condition
type confusion
```

## 5.5 Access, Identity, and Cloud Security Signals

```text
credential exposure
credential leak
token exposure
API key leak
secret leak
authentication flaw
authorization flaw
access control flaw
identity attack
identity threat
privilege abuse
misconfiguration
cloud misconfiguration
public bucket
exposed database
exposed admin panel
exposed dashboard
exposed API
```

---

# 6. Low Keyword List

Low keywords are generic security-context words. They should not usually trigger extraction alone.

```text
security
cybersecurity
cyber
risk
privacy
trust
safety
secure
protection
hardening
update
fix
bug fix
research
analysis
report
warning
alert
investigation
attack
attacker
hacker
identity
access
authentication
authorization
authorisation
login
password
account
admin
administrator
API
cloud
network
endpoint
certificate
encryption
firewall
gateway
proxy
platform
enterprise
SaaS
identity platform
access management
single sign-on
SSO
MFA
multi-factor authentication
```

Low keywords are useful as small score boosters when combined with:

```text
monitored vendor
monitored product
security source
security RSS category
recency
medium keyword
```

---

# 7. Negative Keyword List

Negative keywords suggest non-threat content.

```text
product review
stock price
share price
earnings call
quarterly results
annual results
financial results
market outlook
investor presentation
hiring
job opening
career
conference agenda
event agenda
webinar
sponsored
sponsored post
award
partnership announcement
marketing campaign
product launch
new feature
feature release
customer story
case study
press release
thought leadership
brand campaign
executive appointment
leadership change
office opening
funding round
acquisition
merger
analyst report
industry ranking
```

Negative keywords should reduce score, but should not automatically drop the article when there are strong positive signals.

Example:

```text
"Microsoft discloses security incident in regulatory filing"
```

This may contain business/regulatory context, but it is still threat-relevant.

---

# 8. Phrase Matching Standard

The keyword system should support:

```text
1. Exact phrase matching
2. Case-insensitive matching
3. Basic plural/variant matching
4. Regex matching for structured patterns
5. Word-boundary matching to avoid false matches
```

Prefer phrase patterns over single words where possible.

Example:

```text
"exploited in the wild" is stronger than "exploit"
"data breach" is stronger than "breach"
"security patch" is stronger than "patch"
"ransomware attack" is stronger than "attack"
```

---

# 9. Context Rules and False Positive Control

## 9.1 Exploit

The word `exploit` can be noisy.

Valid cyber contexts:

```text
exploit code
public exploit
exploit available
exploit chain
exploit attempts
exploit used in attacks
```

Noisy contexts:

```text
companies exploit AI opportunities
exploit market growth
exploit business value
```

Rule:

```text
exploit + CVE/vendor/vulnerability/security/source → valid
exploit alone from general business source → low confidence
```

---

## 9.2 Breach

The word `breach` can refer to legal or contractual breach.

Stronger cyber phrases:

```text
data breach
security breach
breached systems
breach notification
breached accounts
breach of customer data
```

Noisy contexts:

```text
breach of contract
breach of agreement
breach of policy
```

Rule:

```text
cyber breach context → Critical
legal/business breach context → Negative or ignore
```

---

## 9.3 Attack

The word `attack` is very noisy.

Stronger cyber phrases:

```text
cyberattack
ransomware attack
phishing attack
supply chain attack
attackers exploited
attackers abused
attackers gained access
```

Noisy contexts:

```text
political attack
market attack
legal attack
critics attack
```

Rule:

```text
attack + cyber/security/malware/exploitation context → valid
attack alone → Low
```

---

## 9.4 Patch

The word `patch` can refer to normal software updates.

Stronger cyber phrases:

```text
security patch
emergency patch
out-of-band patch
patch Tuesday
patches vulnerability
patches exploited flaw
```

Noisy contexts:

```text
feature patch
minor patch
game patch
patch notes
```

Rule:

```text
patch + security/vulnerability/CVE/vendor advisory → Medium or Critical
patch alone → Low or Medium depending on source
```

---

# 10. Upgrade Rules

## 10.1 Low + Low → MAYBE_KEEP

Some combinations of low keywords should upgrade to MAYBE_KEEP.

Examples:

```text
identity + attack
cloud + vulnerability
authentication + bypass
admin + compromise
API + exposure
account + takeover
password + leak
login + bypass
```

---

## 10.2 Medium + Vendor/Product → KEEP

Medium keyword plus monitored vendor/product should usually become KEEP.

Examples:

```text
Fortinet + vulnerability
Zscaler + security advisory
SailPoint + patch
Cloudflare + incident
Microsoft + CVE
CyberArk + privilege escalation
```

---

## 10.3 Medium + Trusted Source → KEEP

Medium keyword plus trusted source should usually become KEEP.

Examples:

```text
security advisory + official vendor source
vulnerability + CISA
patch + Microsoft MSRC
advisory + Fortinet PSIRT
```

---

## 10.4 Medium + Critical Modifier → KEEP

Medium keyword plus a critical modifier should become KEEP.

Examples:

```text
vulnerability + critical
patch + emergency
exploit + public
flaw + unauthenticated
bug + remote code execution
advisory + exploited
```

---

## 10.5 Product Match Stronger Than Vendor Match

Product names are usually more specific than vendor names.

Examples:

```text
FortiOS
FortiGate
IdentityIQ
CyberArk PAM
ZPA
ZIA
Cloudflare Workers
Microsoft Exchange
Microsoft Entra
Windows Server
Azure AD
```

Rule:

```text
monitored product match should score higher than monitored vendor-only match
```

---

# 11. Vendor Matching Rules

Vendor-only matches should be treated carefully for vendors that appear in many general news articles.

Examples of noisy vendors:

```text
Microsoft
Cloudflare
Google
Amazon
Oracle
Cisco
IBM
```

Recommended rule:

```text
vendor + cyber signal = KEEP
vendor + security source = KEEP
vendor + official advisory source = KEEP
vendor only + general source = MAYBE_KEEP or DROP
vendor only + negative business context = DROP or MAYBE_KEEP depending on score
```

Do not automatically KEEP every article just because a monitored vendor appears.

---

# 12. Source Tier Rules

Source tier should influence the filter decision.

## Official Vendor Source

Examples:

```text
Fortinet PSIRT
Microsoft MSRC
Cloudflare Security Blog
Zscaler Security Advisories
CyberArk Security Advisories
SailPoint Security Advisories
```

Rule:

```text
official_vendor source → usually KEEP or at least MAYBE_KEEP
```

## Government / CERT Source

Examples:

```text
CISA
CISA KEV
NVD
CERT/CC
national CERT feeds
```

Rule:

```text
government_cert source → usually KEEP
```

## Security Media Source

Examples:

```text
BleepingComputer
The Hacker News
SecurityWeek
Dark Reading
Rapid7
Mandiant
Cisco Talos
Unit 42
```

Rule:

```text
security_media source + medium keyword → KEEP or MAYBE_KEEP
security_media source + no keyword but recent → MAYBE_KEEP
```

## General News Source

Rule:

```text
general_news source requires stronger signal
```

---

# 13. Recommended Cheap-Filter Decision Policy

The implemented cheap filter uses a layered cascade:

```text
Layer 1: monitored vendor/product gate, with a severe-signal escape hatch
Layer 2: cyber-context gate
Layer 3: priority score chooses KEEP vs MAYBE_KEEP
```

Critical keywords are split inside the implementation:

```text
exploitation-class critical:
  active exploitation, KEV, zero-day/emergency patch, RCE/auth bypass,
  privilege escalation

incident-class critical:
  ransomware, breach/leak, compromise, backdoor, supply-chain attack,
  account takeover
```

## KEEP

Return `KEEP` only after the article has passed both gates and the priority score reaches the
KEEP threshold.

```text
monitored vendor/product present
AND cyber context present
AND priority score is high enough
```

Examples:

```text
Monitored product + exploitation-class critical keyword
Monitored product + CVE + trusted source
Noisy monitored vendor + medium keyword + security-media corroboration + enough score
Quiet monitored vendor + medium keyword + enough score
```

Status mapping:

```text
KEEP → EXTRACTION_PENDING
```

---

## MAYBE_KEEP

Return `MAYBE_KEEP` if any of the following are true:

```text
No monitored vendor/product, but severe RSS signal passes the escape hatch:
  CVE, exploitation-class critical keyword, official vendor source, or government/CERT source

Monitored vendor/product passes Layer 2, but priority score is below KEEP threshold
```

Escape-hatch articles are permanently capped at `MAYBE_KEEP`; extracted text and downstream LLM
classification decide whether they are truly relevant.

Status mapping:

```text
MAYBE_KEEP → EXTRACTION_PENDING_LOW_PRIORITY
```

---

## DROP

Return `DROP` only if:

```text
Layer 1 fails:
  no monitored vendor/product and no severe escape-hatch signal

Layer 2 fails:
  vendor/product mention has no cyber context
  OR negative business/marketing context dominates without CVE/critical keyword
```

Status mapping:

```text
DROP → IGNORED
```

Reason should be precise:

```text
cheap_filter_insufficient_rss_signal
cheap_filter_l1_no_vendor_no_severe_signal
cheap_filter_l2_no_cyber_context
cheap_filter_l2_negative_dominance
```

Avoid using overly final reason names like:

```text
cheap_filter_no_signal
```

because this only means no signal was found in RSS metadata, not necessarily in the full article body.

---

# 14. Example Outcomes

## Example 1

```text
Title: Fortinet warns of actively exploited FortiOS vulnerability
Summary: Customers are urged to patch immediately.
Source: BleepingComputer
```

Expected result:

```text
decision = KEEP
status = EXTRACTION_PENDING
```

Reasons:

```text
monitored product matched
critical keyword matched: actively exploited
medium keyword matched: vulnerability
security media source
```

---

## Example 2

```text
Title: Critical flaw discovered in enterprise identity platform
Summary: Researchers say attackers may gain unauthorized access.
Source: BleepingComputer
```

No CVE. No monitored vendor.

Expected result:

```text
decision = MAYBE_KEEP
status = EXTRACTION_PENDING_LOW_PRIORITY
```

Reasons:

```text
security media source
medium keyword matched: flaw
recent article
```

Blocking reasons:

```text
no CVE found in RSS metadata
no monitored vendor/product found in RSS metadata
```

---

## Example 3

```text
Title: Microsoft announces new AI features for enterprise customers
Summary: New productivity tools are coming to Microsoft 365.
Source: General business news
```

Expected result:

```text
decision = DROP or MAYBE_KEEP
```

Preferred result:

```text
decision = DROP
status = IGNORED
```

Reasons:

```text
vendor matched but no cyber/security signal
negative business/product announcement context
general news source
```

---

## Example 4

```text
Title: Microsoft Patch Tuesday fixes 120 security vulnerabilities
Source: Security media
```

Expected result:

```text
decision = KEEP
status = EXTRACTION_PENDING
```

Reasons:

```text
monitored vendor matched
medium keywords matched: patch, vulnerabilities
security media source
```

---

## Example 5

```text
Title: CISA adds new vulnerability to known exploited catalog
Source: CISA
```

Expected result:

```text
decision = KEEP
status = EXTRACTION_PENDING
```

Reasons:

```text
government/CERT source
known exploited vulnerability context
security context
```

---

# 15. Test Cases

Add unit tests for the keyword classification and cheap-filter decision.

Minimum test cases:

```text
1. CVE in title → KEEP
2. Critical keyword in title → KEEP
3. Monitored product + cyber keyword → KEEP
4. Monitored vendor only from general news → MAYBE_KEEP or DROP
5. Monitored vendor + business negative context → DROP or MAYBE_KEEP
6. Security media + medium keyword → MAYBE_KEEP or KEEP
7. Official vendor source with vague advisory title → KEEP or MAYBE_KEEP
8. Government/CERT source → KEEP
9. No signal + unknown source → DROP
10. RSS category contains vulnerability → MAYBE_KEEP
11. exploit used in business context → DROP or low score
12. breach of contract → DROP
13. data breach → KEEP
14. patch Tuesday → KEEP
15. patch notes for product feature update → DROP or MAYBE_KEEP
```

---

# 16. Summary Policy

Use this final standard:

```text
Critical:
Would this make a security engineer stop and check systems immediately?

Medium:
Would this be worth reading to determine whether action is needed?

Low:
Does this only suggest the topic may be security-related?

Negative:
Does this suggest business, marketing, finance, HR, or non-threat noise?
```

Final cheap-filter policy:

```text
Critical keyword found:
  KEEP

Medium keyword found:
  MAYBE_KEEP
  KEEP if combined with vendor/product/source tier/CVE

Low keyword found:
  Do not extract by itself
  Use only as small score boost

Negative keyword found:
  Reduce score
  Drop only if no strong positive signal exists
```
