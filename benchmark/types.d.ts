import { OutputLogEvent } from "@aws-sdk/client-cloudwatch-logs";

export interface BenchmarkConfig {
  stackName: string;
  runs: number;
  logs: {
    gitBranch: string;
    cloudWatchLogDirPath: string;
    cloudWatchLogFilePath: string;
  };
  setupFunction: Pick<FunctionParameters, "functionName" | "entryPath">;
  benchmarkFunctions: FunctionParameters[];
}

export interface FunctionParameters {
  functionName: string;
  entryPath: string;
  runtimeName?: "NODEJS_16_X" | "NODEJS_18_X";
  useItty?: boolean;
  useBundle?: boolean;
  chart: {
    order: number;
    backgroundColor: string;
    borderColor: string;
  };
}

type CloudWatchLog = OutputLogEvent[];

export interface ApiCallExecution {
  functionName: string;
  runtime: string;
  sdkName: string;
  sdkSource: string;
  apiCallLatency: number;
  httpRequestLatency?: number;
}

interface FunctionExecution extends ApiCallExecution {
  requestId: string;
  isColdStart: boolean;
  initDuration?: number;
  executionDuration: number;
  maxMemory: number;
}
