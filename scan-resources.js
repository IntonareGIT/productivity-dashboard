/**
 * Script to scan Dexie for resource rows with local blob bytes.
 * Run this in the browser console on the Preview URL after signing in.
 * 
 * Reports:
 * - Group (a): blob + confirmed R2 object (safe to remove after confirmation)
 * - Group (b): blob + r2Key but R2 object missing (must upload first)
 * - Group (c): blob with no r2Key (must upload first)
 */

async function scanResources() {
  // Import db from the app
  const { db } = await import('/src/db/db.ts');
  
  const resources = await db.resources.toArray();
  
  const groups = {
    a: [], // blob + confirmed R2 object
    b: [], // blob + r2Key but R2 object missing
    c: [], // blob with no r2Key
  };
  
  let totalBytesA = 0;
  let totalBytesB = 0;
  let totalBytesC = 0;
  
  console.log(`Found ${resources.length} total resources`);
  
  // Filter to only resources with blob bytes
  const withBlob = resources.filter(r => r.blob && r.blob instanceof Blob);
  console.log(`Resources with local blob: ${withBlob.length}`);
  
  for (const resource of withBlob) {
    const size = resource.blob.size;
    const title = resource.title;
    const r2Key = resource.r2Key;
    
    let group = 'c'; // default: no r2Key
    let r2Exists = false;
    
    if (resource.r2Key) {
      // Check if R2 object exists via HEAD request through server
      try {
        const { downloadFromR2 } = await import('/src/features/ai/cloudClient.ts');
        const blob = await downloadFromR2(resource.r2Key);
        r2Exists = blob.size > 0;
      } catch (e) {
        r2Exists = false;
      }
      
      if (r2Exists) {
        group = 'a';
      } else {
        group = 'b';
      }
    }
    
    const info = {
      id: resource.id,
      title,
      size,
      r2Key: resource.r2Key,
      r2Exists,
      group,
    };
    
    groups[group].push(info);
    
    if (group === 'a') totalBytesA += size;
    else if (group === 'b') totalBytesB += size;
    else totalBytesC += size;
  }
  
  console.log('\n=== GROUP (a): Blob + Confirmed R2 Object (Safe to remove) ===');
  console.table(groups.a.map(r => ({ title: r.title, size: `${(r.size/1024/1024).toFixed(2)} MB`, r2Key: r.r2Key })));
  console.log(`Count: ${groups.a.length}, Total: ${(totalBytesA/1024/1024).toFixed(2)} MB`);
  
  console.log('\n=== GROUP (b): Blob + r2Key but R2 Object Missing (Must upload first) ===');
  console.table(groups.b.map(r => ({ title: r.title, size: `${(r.size/1024/1024).toFixed(2)} MB`, r2Key: r.r2Key })));
  console.log(`Count: ${groups.b.length}, Total: ${(totalBytesB/1024/1024).toFixed(2)} MB`);
  
  console.log('\n=== GROUP (c): Blob with No r2Key (Must upload first) ===');
  console.table(groups.c.map(r => ({ title: r.title, size: `${(r.size/1024/1024).toFixed(2)} MB` })));
  console.log(`Count: ${groups.c.length}, Total: ${(totalBytesC/1024/1024).toFixed(2)} MB`);
  
  console.log('\n=== SUMMARY ===');
  console.log(`Group (a): ${groups.a.length} files, ${(totalBytesA/1024/1024).toFixed(2)} MB`);
  console.log(`Group (b): ${groups.b.length} files, ${(totalBytesB/1024/1024).toFixed(2)} MB`);
  console.log(`Group (c): ${groups.c.length} files, ${(totalBytesC/1024/1024).toFixed(2)} MB`);
  console.log(`TOTAL: ${groups.a.length + groups.b.length + groups.c.length} files, ${((totalBytesA+totalBytesB+totalBytesC)/1024/1024).toFixed(2)} MB`);
  
  return { groups, totals: { a: totalBytesA, b: totalBytesB, c: totalBytesC } };
}

// Run it
scanResources().then(result => {
  window.scanResult = result;
  console.log('\nResult stored in window.scanResult');
}).catch(e => console.error('Scan failed:', e));