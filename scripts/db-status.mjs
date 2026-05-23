import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const projects = await prisma.project.findMany({
    include: { clips: { select: { id: true } } },
  });
  console.log(`Projects: ${projects.length}`);
  for (const p of projects) {
    console.log(`  ${p.id}  status=${p.status}  clips=${p.clips.length}  ${p.title}`);
  }
} finally {
  await prisma.$disconnect();
}
