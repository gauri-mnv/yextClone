/* eslint-disable @typescript-eslint/no-floating-promises */
import { NestContainer, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SpelunkerModule } from 'nestjs-spelunker';
import * as fs from 'fs';

const getGlobalModules = (app: any) => {
  const modules = (app.container as NestContainer).getModules();
  const moduleArray = Array.from(modules.values());
  const globalModules = moduleArray
    .filter((module) => module.isGlobal)
    .map((module) => module.metatype.name);
  return globalModules;
};

const generateAppGraph = (app: any) => {
  const globalModules = getGlobalModules(app);
  const tree = SpelunkerModule.explore(app, {
    ignoreImports: [
      /.*ConfigModule$/i,
      (moduleName) => globalModules.includes(moduleName),
    ],
  });
  const root = SpelunkerModule.graph(tree);
  const edges = SpelunkerModule.findGraphEdges(root);

  let graph = 'graph LR\n';
  edges.forEach(({ from, to }) => {
    graph += `  ${from.module.name} --> ${to.module.name}\n`;
  });
  return graph;
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  // main.ts
  // Yeh line DTO ke decorators (@IsString etc.) ko active karti hai
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors();
  const graph = generateAppGraph(app);
  console.log('Dependency Graph:\n', graph);
  fs.writeFileSync('dependency-graph.dot', graph);
  console.log(SpelunkerModule.explore(app));
  await app.listen(process.env.PORT ?? 4000);
  console.log(
    `Server is running on port : http://localhost:${process.env.PORT ?? 4000}`,
  );
}
bootstrap();
