export const environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT!,
  region: process.env.CDK_DEFAULT_REGION!,
};

export interface PlatformConfig {
  readonly projectName: string;
  readonly stage: string;
  readonly springApiImageTag: string;
  readonly pipeline?: {
    readonly connectionArn: string;
    readonly repository: string;
    readonly branch: string;
  };
}

export function getPlatformConfig(app: { node: { tryGetContext(key: string): unknown } }): PlatformConfig {
  const projectName = stringContext(app, 'projectName', 'aws-platform');
  const stage = stringContext(app, 'stage', 'dev');

  const connectionArn = optionalStringContext(app, 'connectionArn');
  const repository = optionalStringContext(app, 'repository');

  return {
    projectName,
    stage,
    springApiImageTag: stringContext(app, 'springApiImageTag', 'latest'),
    pipeline:
      connectionArn && repository
        ? {
            connectionArn,
            repository,
            branch: stringContext(app, 'branch', 'main'),
          }
        : undefined,
  };
}

function stringContext(app: { node: { tryGetContext(key: string): unknown } }, key: string, defaultValue: string): string {
  const value = app.node.tryGetContext(key);
  return typeof value === 'string' && value.trim().length > 0 ? value : defaultValue;
}

function optionalStringContext(app: { node: { tryGetContext(key: string): unknown } }, key: string): string | undefined {
  const value = app.node.tryGetContext(key);
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
