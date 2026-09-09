const bcrypt = require('bcryptjs');

const password = process.argv.slice(2).join(' ');
if (!password) {
  console.error('Usage: npm run hash-password -- "your-password"');
  process.exit(1);
}

(async () => {
  const hash = await bcrypt.hash(password, 12);
  console.log(hash);
})();
