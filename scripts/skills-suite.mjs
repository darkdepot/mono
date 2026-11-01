#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, catalogFile } from './skills-catalog.mjs';
import { runScenario } from './skills-run.mjs';

const json = file => JSON.parse(fs.readFileSync(file,'utf8'));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function projectManifest(file, name) {
  const data=json(file);
  if (!uuid(data.id) || data.name !== name || typeof data.url !== 'string' || !data.url.startsWith('https://linear.app/monotest/')) throw new Error('invalid run project read-back manifest');
  return data;
}

export function scenarioPrompt({scenario,seed,seedProjectFile,projectName,projectFile,project,next,packRoot,paper,designMemoryFile,designMemory,productName,skillPrefix,routeHint}) {
  const owner=`Это отдельная сессия владельца тестового продукта: проверяем скиллы ${productName} с имитированным владельцем, не исполнитель-воркер и не помощник делегированного этапа. Отвечает драйвер через настоящие окна. Владелец явно начинает указанный этап; правила окна проверяемой версии не меняй.`;
  const entry=project
    ? `Проект уже существует: ${JSON.stringify(project)}. Перед записью прочитай его через monotest; id, имя и пространство обязаны совпасть. Используй только этот проект, новый не создавай.`
    : seed ? `Посев уже выполнен отдельным ходом. Прочитай указатель ${seedProjectFile}, затем свежий get_project этого проекта monotest. Используй только его; новый проект не создавай. Не переписывай маршрут посева из-за поля followingStage.`
      : `Idea не имеет посева. Новую идею и проект назови ${projectName}; проект создаёт сам этап только после утверждения. Похожие чужие проекты не используй.`;
  const navigation=`В этом этапе после создания или свежего обратного чтения проекта сохрани JSON {id,name,url} ровно в ${projectFile}; id — поле get_project.uuid (полный UUID, не короткий identifier вроде P-MON-40), имя ${projectName}. Файл находится внутри cwd и должен быть записан этим этапом. Это указатель для соседнего этапа, не доказательство проверки записей. Версии документов и комментариев всегда бери из свежего чтения, не из рецепта. Все команды пака из ${packRoot}.`;
  const design=paper ? `Paper только через предоставленный guard; во всех вызовах fileId=${paper.fileId}. Используй существующую страницу «Как на проде» только как образец; новую версию делай на странице тестовой задачи. Продукт и конфиг уже в cwd; память тестового продукта в ${designMemoryFile}. Посей память: ${JSON.stringify(designMemory)}. Не меняй owner-taste или память другого продукта. PNG экспортируются по filePath ответа: перенеси только эти файлы в новую временную папку прогона, затем утверждённые по правилам этапа. Не используй активный файл владельца.` : '';
  return [owner,entry,navigation,design,`Бриф владельца: ${scenario.brief}`,
    `Этап под проверкой: ${scenario.stage}. Следующий этап после завершения (followingStage): ${next ?? 'none'}. Это выход текущего этапа, не маршрут его посева. ${routeHint ?? ''}`,
    `Начни ${skillPrefix}:${scenario.stage}. ${scenario.prompt}`,
    'Проверяем только этот этап до результата целевого окна. Промежуточные выборы и свободные вопросы отвечаются драйвером. Следующий этап запускает драйвер отдельным вызовом в этом же проекте; передай результат и закончи ход. Не начинай реализацию, доставку или установку. Не подменяй окно текстом и не считай свободный ответ утверждением.'
  ].filter(Boolean).join('\n\n');
}

function seedPrompt({seed,projectName,projectFile,dumpDir,packRoot,brief}){
  return [`Только посев входа в monotest, без окон и вызова этапов. Создай один свежий проект ${projectName}. Не используй похожие проекты. Все записи только monotest после подтверждения пространства чтением.`,
    `Бриф изменения существующего тестового продукта: ${brief}`,
    `Рецепт посева:\n${JSON.stringify(seed,null,2)}`,
    ...(seed.prdApprovalTemplate?['prdApprovalTemplate публикуй дословно, заменяя только placeholders свежими id/версиями из обратного чтения. Его next — вход этапа под проверкой; менять его нельзя.']:[]),
    `После посева прочитай проект и сохрани {id,name,url} в ${projectFile}; id — поле get_project.uuid (полный UUID, не короткий identifier вроде P-MON-40), name=${projectName}.`,
    ...(seed.entryStage?[`Сохрани свежие сырые ответы get_project и всех страниц list_comments в ${dumpDir}: project.json, comments-N.json и comments-N.request.json (первая {}, следующие {cursor}). Также get_document PRD в prd.json. Ответы и курсоры не сочиняй. Драйвер сам выполнит node ${packRoot}/scripts/idea-gate.mjs route --mode fresh --dump ${dumpDir}. Ожидаемый вход: ${seed.entryStage}.`]:[]),
    'Закончи ход после обратного чтения. Этап ещё не начинай: драйвер сначала проверяет посев.'
  ].join('\n\n');
}

export async function runSuite(request, execute = runScenario) {
  const selection=json(request.selectionFile), catalog=loadCatalog(request.indexFile);
  if (selection.indexFile !== catalog.indexFile || selection.catalogDigest !== catalog.digest) throw new Error('selection catalog changed');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(request.runId ?? '') || !path.isAbsolute(request.outputDir ?? '') || !path.isAbsolute(request.cwd ?? '')) throw new Error('runId and absolute outputDir/cwd required');
  if (!Array.isArray(selection.units) || !Array.isArray(selection.expectedItems) || !selection.hosts?.length) throw new Error('invalid saved selection');
  const proof=request.workspaceProof ?? {tool:'mcp__monotest__get_workspace',input:{},path:['name'],equals:'Mono Test'};
  if (proof.equals !== 'Mono Test' || JSON.stringify(proof.path) !== '["name"]' || proof.tool !== 'mcp__monotest__get_workspace') throw new Error('suite requires the pinned Mono Test workspace proof');
  const requiresPaper=selection.units.some(u=>u.scenarios.some(key=>catalog.scenarios.get(key)?.stage === 'design'));
  if (requiresPaper && (!request.paper?.fileId?.trim() || !request.paper.command || !Array.isArray(request.paper.args) || !path.isAbsolute(request.designMemoryFile ?? ''))) throw new Error('Design requires parameter fileId, Paper command/args and test designMemoryFile');
  if (request.mcpServers?.paper) throw new Error('Paper must be configured through the file guard');
  const expected=selection.units.flatMap(unit=>selection.hosts.flatMap(host=>unit.scenarios.map(key=>({id:`${unit.id}:${key}:${host}`,source:'scenario',unit:unit.id,scenario:key,host}))));
  if (JSON.stringify(expected) !== JSON.stringify(selection.expectedItems)) throw new Error('saved expected items do not match selected units');
  fs.mkdirSync(request.outputDir); // never overwrite an earlier run
  fs.writeFileSync(path.join(request.outputDir,'expected-items.json'),JSON.stringify(selection.expectedItems,null,2)+'\n',{flag:'wx'});
  const manifestDir=fs.mkdtempSync(path.join(request.cwd,`.mono-skills-${request.runId}-`));
  const results=[];
  for (const unit of selection.units) for (const host of selection.hosts) {
    const projectName=`monotest-${request.runId}-${host}-${unit.id}`;
    let project=null;
    for (const [position,key] of unit.scenarios.entries()) {
      const scenario=catalog.scenarios.get(key);
      if (!scenario) throw new Error(`selected scenario removed: ${key}`);
      const flow=scenario.hosts[host], outputDir=path.join(request.outputDir,`${unit.id}-${host}-${position}`);
      const projectFile=path.join(manifestDir,`${unit.id}-${host}-${position}-project.json`);
      const seedProjectFile=projectFile+'.seed.json',dumpDir=projectFile+'.route';
      const seedPath=position===0 && unit.seed ? unit.seed : scenario.seed;
      const seed=!project && seedPath ? JSON.parse(JSON.stringify(json(catalogFile(catalog.root,seedPath))).replaceAll('<projectName>',projectName)) : null;
      const nextKey=unit.scenarios[position+1], next=nextKey ? catalog.scenarios.get(nextKey)?.stage : scenario.next;
      const expectedWindows=flow.expectedWindows.map(window=>next && window.role==='approval'
        ? {...window,reason:catalog.stages.get(next).name} : window);
      const servers={...request.mcpServers};
      if (scenario.stage === 'design') {
        const guardFile=path.join(request.outputDir,`${unit.id}-${host}-${position}-paper.json`);
        fs.writeFileSync(guardFile,JSON.stringify({...request.paper,log:guardFile+'.jsonl'})+'\n',{flag:'wx'});
        servers.paper={command:process.execPath,args:[catalogFile(catalog.root,catalog.index.paperGuard),guardFile]};
      }
      const designMemory=scenario.stage==='design' ? json(catalogFile(catalog.root,scenario.seed)).designMemory : null;
      const target=catalog.scenarios.get(unit.target);
      if (!target) throw new Error('selected unit target missing');
      const brief=target.brief+` Идентификатор тестового проекта этой правки: ${projectName}. Название колонки всегда «Источник», имя прогона в него не добавляй.`;
      const prompt=scenarioPrompt({scenario:{...scenario,brief},seed,seedProjectFile,projectName,projectFile,project,next,packRoot:request.packRoot,paper:scenario.stage==='design'?request.paper:null,designMemoryFile:request.designMemoryFile,
        designMemory:designMemory ? {...designMemory,firstLine:request.cwd,fileId:request.paper.fileId} : null,
        productName:catalog.index.productName,skillPrefix:catalog.index.skillPrefix,routeHint:catalog.index.routeHints?.[next]});
      const runRequest={host,cwd:request.cwd,packRoot:request.packRoot,outputDir,authFile:request.authFile,
        timeoutMs:request.timeoutMs ?? 1_800_000,idleMs:20_000,maxTurns:request.maxTurns??128,mcpServers:servers,
        workspaceProof:proof,
        ...(seed?{seed:{prompt:seedPrompt({seed,projectName,projectFile:seedProjectFile,dumpDir,packRoot:request.packRoot,brief}),projectName,projectFile:seedProjectFile,dumpDir,expectedStage:seed.entryStage??null,configFile:path.join(request.cwd,'.agents/mono-workflow.config.json')}}:{}),
        context:{projectName,projectFile,project,entryStage:scenario.stage,followingStage:next},scenario:{prompt,brief,allowedTools:['*'],stopAfterExpectedWindows:true,...flow,expectedWindows}};
      fs.writeFileSync(outputDir+'-request.json',JSON.stringify(runRequest,null,2)+'\n',{flag:'wx'});
      let result;
      try {
        result=await execute(runRequest);
        if (result.status === 'passed') {
          const observed=projectManifest(projectFile,projectName);
          if (project && JSON.stringify(observed) !== JSON.stringify(project)) throw new Error('chain changed its run project');
          fs.copyFileSync(projectFile,outputDir+'-project.json',fs.constants.COPYFILE_EXCL);
          project=observed;
        }
      } catch(error) {
        result={...result,status:'failed',reason:error.message};
      }
      const item={unit:unit.id,scenario:key,host,status:result.status,outputDir,result};results.push(item);
      if (result.status !== 'passed') break; // later chain members remain explicitly unverified
    }
  }
  const items=selection.expectedItems.map(expected=>{
    const actual=results.find(r=>r.unit===expected.unit && r.scenario===expected.scenario && r.host===expected.host);
    return {...expected,status:actual?.status ?? 'unverified',evidence:actual?.outputDir ?? 'previous chain stage did not pass'};
  });
  const status=items.some(i=>i.status==='failed')?'failed':items.some(i=>i.status!=='passed')?'unverified':'passed';
  const result={status,items,results,boundary:'mechanical driver results; conversation rubric and fresh record verification are separate, not a QA certificate'};
  fs.writeFileSync(path.join(request.outputDir,'suite-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const result=await runSuite(json(process.argv[2])); console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:result.status==='failed'?1:2; }
  catch(error) { console.error(error.message);process.exitCode=2; }
}
