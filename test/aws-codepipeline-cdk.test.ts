import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as AwsCodepipelineCdk from '../lib/aws-codepipeline-cdk-stack';
import { AppContext } from '../lib/app-context';

test('Empty Stack', () => {
    //const app = new cdk.App();
    const appContext = new AppContext({
      appConfigEnvName: 'APP_CONFIG',
    });
    // WHEN
    const stack = new AwsCodepipelineCdk.AwsCodepipelineCdkStack(appContext, appContext.appConfig.Stack.PipelineInfra);
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
