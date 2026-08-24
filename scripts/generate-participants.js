const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const projectRoot = path.resolve(__dirname, '..');
const dbPath = path.join(projectRoot, 'stamp.db');
const outputPath = path.join(projectRoot, 'public', 'lottery-system', 'participants.json');

const db = new DatabaseSync(dbPath, { readOnly: true });

try {
  const participants = db.prepare(`
    SELECT lottery_number AS id, weight
    FROM lottery
    WHERE lottery_number IS NOT NULL
      AND lottery_number <> ''
    ORDER BY id ASC
  `).all().map(participant => ({
    id: String(participant.id),
    weight: Number(participant.weight)
  }));

  fs.writeFileSync(outputPath, `${JSON.stringify(participants, null, 2)}\n`, 'utf8');
  console.log(`Generated ${participants.length} participants: ${path.relative(projectRoot, outputPath)}`);
} finally {
  db.close();
}
