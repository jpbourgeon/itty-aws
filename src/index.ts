import { Sha256 } from "@aws-crypto/sha256-js";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import type { AwsCredentialIdentity, Provider } from "@aws-sdk/types";
import type { SDK } from "./sdk.generated.js";

export interface ClientOptions {
  endpoint?: string;
  credentials?: AwsCredentialIdentity | Provider<AwsCredentialIdentity>;
}

declare const fetch: typeof import("node-fetch").default;

export const AWS: SDK = new Proxy({} as any, {
  get: (_, className: keyof SDK) => {
    const region = process.env.AWS_REGION!;
    if (!region) {
      throw new Error(`Could not determine AWS_REGION`);
    }

    return class {
      constructor(options?: ClientOptions) {
        const endpoint =
          options?.endpoint ?? resolveEndpoint(className, region);
        // TODO: support other types of credential providers
        const credentials = options?.credentials ?? fromEnv();
        return new Proxy(
          {},
          {
            get: (_target, methodName: string) => {
              return async (input: any) => {
                const url = new URL(`https://${endpoint}`);

                // See: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.LowLevelAPI.html

                const request = new HttpRequest({
                  hostname: url.hostname,
                  path: url.pathname,
                  protocol: url.protocol,
                  method: "POST",
                  body: JSON.stringify(input),
                  headers: {
                    // host is required by AWS Signature V4: https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
                    host: url.host,
                    "Accept-Encoding": "identity",
                    "Content-Type": resolveContentType(className, methodName),
                    "X-Amz-Target": resolveXAmzTarget(className, methodName),
                    "User-Agent": "itty-aws",
                  },
                });

                const signer = new SignatureV4({
                  credentials,
                  service: resolveService(className),
                  region,
                  sha256: Sha256,
                });

                const signedRequest = await signer.sign(request);

                const response = await fetch(url.toString(), {
                  headers: signedRequest.headers,
                  body: signedRequest.body,
                  method: signedRequest.method,
                });

                const isJson = response.headers
                  .get("content-type")
                  ?.startsWith("application/x-amz-json");

                if (response.status === 200) {
                  return isJson ? response.json() : response.text();
                } else {
                  // see: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html
                  // for now we'll just throw the error as a json object
                  // TODO: throw something that is easy to branch on and check instanceof - this may increase bundle size though
                  throw isJson
                    ? new AWSError(await response.json())
                    : new Error(await response.text());
                }
              };
            },
          }
        );
      }
    };
  },
});

export class AWSError extends Error {
  readonly type?: string;
  constructor(error: any) {
    super(typeof error?.message === "string" ? error.message : error.__type);
    this.type = error.__type;
  }
}

const j1 = "application/x-amz-json-1.0";
const j1_1 = "application/x-amz-json-1.1";
const contentTypeMap: Partial<Record<keyof SDK, string>> = {
  DynamoDB: j1,
  SSM: j1_1,
  EventBridge: j1_1,
};

function resolveContentType(className: keyof SDK, methodName: string) {
  return contentTypeMap[className] ?? "application/x-amz-json-1.0";
}

function resolveXAmzTarget(className: keyof SDK, methodName: string) {
  const action = resolveAction(methodName);
  if (className === "SSM") {
    return `AmazonSSM.${action}`;
  } else if (className === "EventBridge") {
    return `AWSEvents.${action}`;
  } else if (className === "DynamoDB") {
    return `${className}_${resolveVersion(className).replaceAll(
      "-",
      ""
    )}.${action}`;
  } else {
    throw new Error(`unsupported service: ${className}`);
  }
}

const serviceMappings: Partial<Record<keyof SDK, string>> = {
  EventBridge: "events",
};

function resolveService(className: keyof SDK): string {
  return serviceMappings[className] ?? className.toLocaleLowerCase();
}

// see: https://docs.aws.amazon.com/general/latest/gr/ddb.html
function resolveEndpoint(serviceName: keyof SDK, region: string) {
  // TODO: this doesn't work in all cases ...

  return `${resolveService(
    serviceName
  ).toLocaleLowerCase()}.${region}.amazonaws.com`;
}

// see: https://stackoverflow.com/questions/36490756/aws-rest-api-without-sdk
// see: https://docs.aws.amazon.com/general/latest/gr/create-signed-request.html#create-canonical-request
function resolveAction(methodName: string) {
  return `${methodName.charAt(0).toUpperCase()}${methodName.substring(1)}`;
}

const versionMap: Partial<Record<keyof SDK, string>> = {
  DynamoDB: "2012-08-10",
  EventBridge: "2015-10-07",
  SSM: "2014-11-06",
};

// see: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html for an example of where this can be found
const resolveVersion = (className: keyof SDK): string =>
  versionMap[className] ??
  (() => {
    throw new Error(`Unsupported service: ${className}`);
  })();
