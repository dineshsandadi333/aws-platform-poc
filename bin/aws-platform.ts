import * as cdk from 'aws-cdk-lib';
import { SharedStack } from '../lib/stacks/shared-stack';
import { NetworkingStack } from '../lib/stacks/networking-stack';
import { ApplicationStack } from '../lib/stacks/application-stack';
import { PipelineStack } from '../lib/stacks/pipeline-stack';
import { environment } from '../lib/config/environment';

const app = new cdk.App();

const shared = new SharedStack(app, 'SharedStack', { env: environment });

const networking = new NetworkingStack(app, 'NetworkingStack', { env: environment });
networking.addDependency(shared);

const application = new ApplicationStack(app, 'ApplicationStack', { env: environment });
application.addDependency(networking);

const pipeline = new PipelineStack(app, 'PipelineStack', { env: environment });
pipeline.addDependency(shared);