import { getDatabasePool } from '../src/db/pool.js';
import { VendorRepository } from '../src/db/repositories/vendor.repository.js';
import { monitoredVendors } from '../src/storage/vendorInventory.js';

async function main(): Promise<void> {
  const pool = getDatabasePool();
  const vendors = new VendorRepository(pool);

  try {
    for (const vendorProduct of monitoredVendors) {
      await vendors.seedVendorProduct({
        vendor: vendorProduct.vendor,
        product: vendorProduct.product,
        aliases: vendorProduct.aliases,
        criticality: vendorProduct.criticality,
        inProduction: vendorProduct.inProduction,
        newsVolume: vendorProduct.newsVolume,
      });
    }

    console.log(`Seeded ${monitoredVendors.length} monitored vendor product(s).`);
  } finally {
    await pool.end();
  }
}

await main();
