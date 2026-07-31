import { Injectable } from "@nestjs/common";

interface TribeCostInput {
  apiCalls: number;
  kafkaPublishes: number;
  gbScanned: number;
}

@Injectable()
export class TribeCostService {
  estimateMonthlyChargeback(input: TribeCostInput) {
    const apiCallCost = roundCurrency((input.apiCalls / 1000) * 0.5);
    const kafkaPublishCost = roundCurrency((input.kafkaPublishes / 1000) * 0.5);
    const analyticsScanCost = roundCurrency(input.gbScanned * 0.05);

    return {
      apiCallCost,
      kafkaPublishCost,
      analyticsScanCost,
      totalCost: roundCurrency(
        apiCallCost + kafkaPublishCost + analyticsScanCost,
      ),
    };
  }
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
