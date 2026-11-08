/*
  Warnings:

  - You are about to drop the column `captureToken` on the `WebhookEvent` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "WebhookEvent_captureToken_idx";

-- AlterTable
ALTER TABLE "WebhookEvent" DROP COLUMN "captureToken",
ADD COLUMN     "captureEndpointId" TEXT;

-- CreateTable
CREATE TABLE "CaptureEndpoint" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "source" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaptureEndpoint_token_key" ON "CaptureEndpoint"("token");

-- CreateIndex
CREATE INDEX "WebhookEvent_captureEndpointId_idx" ON "WebhookEvent"("captureEndpointId");

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_captureEndpointId_fkey" FOREIGN KEY ("captureEndpointId") REFERENCES "CaptureEndpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
