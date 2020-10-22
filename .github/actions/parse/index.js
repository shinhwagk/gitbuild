const core = require('@actions/core');
const github = require('@actions/github');

const str = '[{"context":"images/1.0.0","file":"images/1.0.0/Dockerfile","tags":"user/app:latest"}]'

try {
    const nameToGreet = core.getInput('who-to-greet');
    console.log(`Hello ${nameToGreet}!`);
    core.setOutput("time", str);
    const payload = JSON.stringify(github.context.payload, undefined, 2)
    console.log(`The event payload: ${payload}`);
} catch (error) {
    core.setFailed(error.message);
}
