-- CreateEnum
CREATE TYPE "FailureCategory" AS ENUM ('authentication', 'payload_validation', 'timeout', 'network_failure', 'rate_limit', 'server_error', 'application_logic', 'insufficient_evidence');

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captureToken" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "requestUrl" TEXT NOT NULL,
    "requestMethod" TEXT NOT NULL,
    "requestHeaders" JSONB NOT NULL,
    "requestBody" JSONB,
    "responseStatus" INTEGER,
    "responseHeaders" JSONB,
    "responseBody" JSONB,
    "latencyMs" INTEGER,
    "errorText" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "diagnosis" JSONB NOT NULL,
    "failureCategory" "FailureCategory" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationMessage" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiDoc" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "ApiDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_source_idx" ON "WebhookEvent"("source");

-- CreateIndex
CREATE INDEX "WebhookEvent_captureToken_idx" ON "WebhookEvent"("captureToken");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_eventId_idx" ON "DeliveryAttempt"("eventId");

-- CreateIndex
CREATE INDEX "Investigation_eventId_idx" ON "Investigation"("eventId");

-- CreateIndex
CREATE INDEX "Investigation_failureCategory_idx" ON "Investigation"("failureCategory");

-- CreateIndex
CREATE INDEX "InvestigationMessage_investigationId_idx" ON "InvestigationMessage"("investigationId");

-- CreateIndex
CREATE INDEX "ApiDoc_provider_idx" ON "ApiDoc"("provider");

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationMessage" ADD CONSTRAINT "InvestigationMessage_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
