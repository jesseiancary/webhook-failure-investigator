-- AlterTable
ALTER TABLE "InvestigationMessage" ADD COLUMN     "completionTokens" INTEGER,
ADD COLUMN     "costUsd" DECIMAL(10,6),
ADD COLUMN     "model" TEXT,
ADD COLUMN     "promptTokens" INTEGER,
ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "InvestigationMessage_investigationId_seq_idx" ON "InvestigationMessage"("investigationId", "seq");
