import { config } from "dotenv";
config();
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: tsx scripts/dump-conversation.ts <conversationId>");
    process.exit(1);
  }

  const convo = await prisma.conversation.findUnique({
    where: { id },
    include: {
      product: { select: { code: true, name: true, insuranceType: true } },
      candidateProduct: { select: { code: true, name: true, insuranceType: true } },
      customer: {
        select: {
          id: true,
          name: true,
          language: true,
          extractedProfile: true,
          gdprConsentAt: true,
          gdprConsentScope: true,
          aiDisclosureAcknowledgedAt: true,
        },
      },
      application: { select: { id: true, status: true, tierId: true, levelId: true } },
      messages: { orderBy: { createdAt: "asc" } },
      turnTraces: { orderBy: { messageIndex: "asc" } },
      score: true,
    },
  });

  if (!convo) {
    console.error("conversation not found");
    process.exit(1);
  }

  const phase = convo.mode === 'POST_SALE'
    ? 'post_sale'
    : (convo.application && convo.application.status !== 'COMPLETED'
        ? 'application'
        : 'presentation')

  console.log("=== META ===");
  console.log(JSON.stringify({
    id: convo.id,
    phase,
    productCode: convo.product?.code,
    productName: convo.product?.name,
    insuranceType: convo.product?.insuranceType,
    candidate: convo.candidateProductId ? {
      productId: convo.candidateProductId,
      productCode: convo.candidateProduct?.code,
      productName: convo.candidateProduct?.name,
      confidence: convo.candidateConfidence,
      setAt: convo.candidateSetAt,
    } : null,
    status: convo.status,
    mode: convo.mode,
    language: convo.language,
    messageCount: convo.messageCount,
    startedAt: convo.startedAt,
    completedAt: convo.completedAt,
    customer: convo.customer,
    application: convo.application,
    metadata: convo.metadata,
  }, null, 2));

  console.log("\n=== MESSAGES (" + convo.messages.length + ") ===");
  for (const [i, m] of convo.messages.entries()) {
    console.log(`\n--- [${i}] ${m.role} @ ${m.createdAt.toISOString()} ---`);
    console.log(m.content);
    if (m.toolCalls) console.log("TOOL_CALLS:", JSON.stringify(m.toolCalls, null, 2));
    if (m.toolResults) console.log("TOOL_RESULTS:", JSON.stringify(m.toolResults, null, 2));
  }

  console.log("\n=== TURN TRACES (" + convo.turnTraces.length + ") ===");
  for (const t of convo.turnTraces) {
    console.log(`\n--- turn ${t.messageIndex} | ${t.provider}/${t.model} | ${t.latencyMs}ms | $${t.cost ?? 0} ---`);
    if (t.anomalies) console.log("ANOMALIES:", JSON.stringify(t.anomalies, null, 2));
    console.log("PHASES:", JSON.stringify(t.phases, null, 2));
  }

  if (convo.score) {
    console.log("\n=== SCORE ===");
    console.log(JSON.stringify(convo.score, null, 2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
