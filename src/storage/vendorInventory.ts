import type { VendorProduct } from '../types/domain.js';

/**
 * Proof-of-concept scope: 3 vendor products only.
 * Chosen to cover one quiet critical vendor (CyberArk), one mid-volume vendor
 * (Zscaler), and one high-volume noisy vendor (Microsoft), so both the
 * positive and negative filter paths are exercised with sources that are easy
 * to find. Expand the inventory after the POC evaluation gate is trustworthy.
 */
export const monitoredVendors: VendorProduct[] = [
  {
    id: 'vp_cyberark_pas',
    vendor: 'CyberArk',
    product: 'Privileged Access Security',
    aliases: ['CyberArk PAS', 'CyberArk PAM', 'CyberArk Privileged Access Manager'],
    criticality: 'critical',
    inProduction: true,
  },
  {
    id: 'vp_zscaler_zia',
    vendor: 'Zscaler',
    product: 'Zscaler Internet Access',
    aliases: ['ZIA', 'Zscaler Internet Access'],
    criticality: 'high',
    inProduction: true,
  },
  {
    id: 'vp_microsoft_windows_server',
    vendor: 'Microsoft',
    product: 'Windows Server',
    aliases: ['Microsoft Windows Server', 'Windows Server', 'Microsoft Exchange', 'Microsoft Entra', 'Azure AD'],
    criticality: 'high',
    inProduction: true,
  },
];
