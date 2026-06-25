import type { VendorProduct } from '../types/domain.js';

export const monitoredVendors: VendorProduct[] = [
  {
    id: 'vp_sailpoint_iiq',
    vendor: 'SailPoint',
    product: 'IdentityIQ',
    aliases: ['SailPoint IIQ', 'IdentityIQ', 'IIQ'],
    criticality: 'high',
    inProduction: true,
  },
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
    id: 'vp_cloudflare',
    vendor: 'Cloudflare',
    product: 'Cloudflare platform',
    aliases: ['Cloudflare WAF', 'Cloudflare Zero Trust', 'Cloudflare Access'],
    criticality: 'medium',
    inProduction: false,
  }
];
