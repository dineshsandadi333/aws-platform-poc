import * as cdk from 'aws-cdk-lib';
import { SharedStack } from '../lib/stacks/shared-stack';
import { NetworkingStack } from '../lib/stacks/networking-stack';
import { ApplicationStack } from '../lib/stacks/application-stack';
import { PipelineStack } from '../lib/stacks/pipeline-stack';
import { environment, getPlatformConfig } from '../lib/config/environment';

const app = new cdk.App();
const config = getPlatformConfig(app);

const stackName = (name: string) => `${config.projectName}-${config.stage}-${name}`;

const shared = new SharedStack(app, stackName('shared'), { env: environment, config });

const networking = new NetworkingStack(app, stackName('networking'), { env: environment, config });

const application = new ApplicationStack(app, stackName('application'), {
  env: environment,
  config,
  shared,
  networking,
});

const pipeline = new PipelineStack(app, stackName('pipeline'), {
  env: environment,
  config,
  shared,
});
