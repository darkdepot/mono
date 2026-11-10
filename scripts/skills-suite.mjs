#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadCatalog, catalogFile } from './skills-catalog.mjs';
import { scenarioExpectation } from './skills-select.mjs';
import { verifyScenarioRecords } from './skills-records.mjs';
import { checkEndings } from './skills-trace.mjs';
import { runScenario } from './skills-run.mjs';
import { anchored } from './skills-owner.mjs';
import { permittedStages } from './skills-stage-driver.mjs';
import { rubricDigest } from './skills-rubric.mjs';

const json = file => JSON.parse(fs.readFileSync(file,'utf8'));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function checkPack(packRoot,head) {
  if(!/^[a-f0-9]{40}$/.test(head??''))throw new Error('pack revision: selected commit required');
  let checkout,revision,changed;
  try {
    const git=(...args)=>execFileSync('git',['-C',packRoot,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    checkout=git('rev-parse','--show-toplevel');revision=git('rev-parse','HEAD');
    changed=git('status','--porcelain','--untracked-files=no')||git('status','--porcelain','--untracked-files=all','--ignored=matching','--','skills','references','templates','scripts','agents','hooks','.claude-plugin','.codex-plugin','.mcp.json','package.json');
  }catch{throw new Error('pack checkout: a versioned checkout is required');}
  if(fs.realpathSync(checkout)!==fs.realpathSync(packRoot))throw new Error('pack checkout: packRoot must be the checkout root');
  if(revision!==head)throw new Error('pack revision differs from selection.head');
  if(changed)throw new Error('pack execution files changed since selection.head');
}
function projectIdentity(data, name) {
  if (!uuid(data?.id) || data.name !== name || typeof data.url !== 'string' || !data.url.startsWith('https://linear.app/monotest/')) throw new Error('invalid run project read-back manifest');
  return data;
}

export function scenarioPrompt({scenario,host,seed,seedProjectFile,projectName,projectFile,project,next,packRoot,paper,designMemoryFile,designMemory,productName,skillPrefix,routeHint}) {
  for (const [key,value] of Object.entries({projectFile,packRoot})) if (!path.isAbsolute(value ?? '') || path.basename(value)==='undefined') throw new Error(`absolute ${key} required`);
  if (seed && !project && !path.isAbsolute(seedProjectFile ?? '')) throw new Error('absolute seedProjectFile required');
  if (!projectName?.trim()) throw new Error('projectName required');
  const owner=`Это отдельная сессия владельца тестового продукта: проверяем скиллы ${productName} с имитированным владельцем. Драйвер отвечает обычным текстом на последнее сообщение завершённого хода. Владелец явно начинает указанный этап; правила проверяемой версии не меняй.`;
  const entry=project
    ? `Проект уже существует: ${JSON.stringify(project)}. Перед записью прочитай его через monotest; id, имя и пространство обязаны совпасть. Используй только этот проект, новый не создавай.`
    : seed ? `Посев уже выполнен отдельным ходом. Прочитай указатель ${seedProjectFile}, затем свежий get_project этого проекта monotest. Используй только его; новый проект не создавай. Не переписывай маршрут посева из-за поля followingStage.`
      : `Idea не имеет посева. Новую идею и проект назови ${projectName}; проект создаёт сам этап только после утверждения. Похожие чужие проекты не используй.`;
  const navigation=`В этом этапе после создания или свежего обратного чтения проекта сохрани JSON {id,name,url} ровно в ${projectFile}; id — поле get_project.uuid (полный UUID, не короткий identifier вроде P-MON-40), имя ${projectName}. Файл находится внутри cwd и должен быть записан этим этапом. Это указатель для соседнего этапа, не доказательство проверки записей. Версии документов и комментариев всегда бери из свежего чтения, не из рецепта. Все команды пака из ${packRoot}.`;
  const design=paper ? `Paper только через предоставленный guard; в каждом вызове явный fileId из списка ${JSON.stringify(paper.fileIds)}. Песочница тестовой задачи — первый файл списка. Главный файл — mainFileId подготовленной памяти: в нём только сборка и обновление выпущенных разделов по правилам этапа; страницу «Как на проде», если она есть, используй только как выпущенный образец. Остальные разрешённые файлы только для опор. Новую версию делай только на странице тестовой задачи в песочнице. Продукт и конфиг уже в cwd; память тестового продукта в ${designMemoryFile}. ${designMemory?.seedInSetup?'Подготовленная память':'Посей память'}: ${JSON.stringify(designMemory)}. Не меняй owner-taste или память другого продукта. Guard копирует только названные Paper export файлы в доступный каталог прогона и возвращает новые пути. Выполни обычный шаг архивации утверждённых PNG из этих путей. Архив утверждённых PNG продукта: ${path.join(path.dirname(designMemoryFile),'approved')}. Не используй активный файл владельца.` : '';
  return [owner,entry,navigation,design,`Бриф владельца: ${scenario.brief}`,
    `Этап под проверкой: ${scenario.stage}. Следующий этап после завершения (followingStage): ${next ?? 'none'}. Это выход текущего этапа, не маршрут его посева. ${routeHint ?? ''}`,
    `Начни ${skillPrefix}:${scenario.stage}. ${scenario.prompt}`,
    'Для проверяемых записей Codex каждый monotest MCP вызывай отдельным exec строго в форме const r = await tools.<имя>(<JSON>); text(r); с буквальным JSON аргументов. Не объединяй MCP-вызовы в один exec. Это сохраняет связь запроса, ответа и свежего чтения.',
    'Проверяем только этот этап до результата разговора с владельцем. Соблюдай правила установленной версии этапа. Не выполняй сам следующий этап: для вызова следующего этапа после разрешающего ответа используй mcp__stage_driver__start_stage с stage=followingStage и projectId текущего проекта. Это перехват вызова, следующий этап выполнит драйвер. Нет согласия на старт или нет этого инструмента — следующего вызова нет. Собственная запись старта Handoff остаётся в Handoff. Не начинай реализацию, доставку или установку.'
  ].filter(Boolean).join('\n\n');
}

function seedPrompt({seed,projectName,projectFile,dumpDir,packRoot,brief}){
  return [`Только посев входа в monotest, без окон и вызова этапов. Создай один свежий проект ${projectName}. Не используй похожие проекты. Все записи Linear только monotest после подтверждения пространства чтением. Подготовка синтетических Paper-страниц, если задана в designMemory.instructions, только через guard в переданных fileId.`,
    `Бриф изменения существующего тестового продукта: ${brief}`,
    `Рецепт посева:\n${JSON.stringify(seed,null,2)}`,
    ...(seed.prdApprovalTemplate?['prdApprovalTemplate публикуй дословно, заменяя только placeholders свежими id/версиями из обратного чтения. Его next — вход этапа под проверкой; менять его нельзя.']:[]),
    `После посева прочитай проект и сохрани {id,name,url} в ${projectFile}; id — поле get_project.uuid (полный UUID, не короткий identifier вроде P-MON-40), name=${projectName}.`,
    ...(seed.entryStage?[`Сохрани свежие сырые ответы get_project и всех страниц list_comments в ${dumpDir}: project.json, comments-N.json и comments-N.request.json (первая {}, следующие {cursor}). Также get_document PRD в prd.json. Ответы и курсоры не сочиняй. Драйвер сам выполнит node ${packRoot}/scripts/idea-gate.mjs route --mode fresh --dump ${dumpDir}. Ожидаемый вход: ${seed.entryStage}.`]:[]),
    'Закончи ход после обратного чтения. Этап ещё не начинай: драйвер сначала проверяет посев.'
  ].join('\n\n');
}

export async function runSuite(request, execute = runScenario, verify = verifyScenarioRecords) {
  const startedAt=new Date().toISOString(),suiteStart=Date.now();
  const selection=json(request.selectionFile), catalog=loadCatalog(request.indexFile);
  if (selection.indexFile !== catalog.indexFile || selection.catalogDigest !== catalog.digest) throw new Error('selection catalog changed');
  checkPack(request.packRoot,selection.head);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(request.runId ?? '') || !path.isAbsolute(request.outputDir ?? '') || !path.isAbsolute(request.cwd ?? '')) throw new Error('runId and absolute outputDir/cwd required');
  if (!Array.isArray(selection.units) || !Array.isArray(selection.expectedItems) || !selection.hosts?.length) throw new Error('invalid saved selection');
  const release=selection.purpose==='release'&&catalog.index.release!==undefined;
  if(release&&(!request.releaseStartReason?.trim()||selection.units.length!==1||selection.units[0].seed))throw new Error('release requires a seedless chain and explicit orchestrator start reason');
  if(release) {
    const chain=catalog.index.release?.stages.map(id=>`${id}/${catalog.stages.get(id).main}`);
    if(!chain||JSON.stringify(selection.units[0].scenarios)!==JSON.stringify(chain)||selection.units[0].target!==chain[0])throw new Error('release selection differs from the complete catalog plan');
  }
  const releaseDesignStart=(previous,next)=>release&&previous?.stage==='design'&&next==='tech-evaluation'&&previous.status==='passed';
  const proof=request.workspaceProof ?? {tool:'mcp__monotest__get_workspace',input:{},path:['name'],equals:'Mono Test'};
  if (proof.equals !== 'Mono Test' || JSON.stringify(proof.path) !== '["name"]' || proof.tool !== 'mcp__monotest__get_workspace') throw new Error('suite requires the pinned Mono Test workspace proof');
  if (request.mcpServers?.paper) throw new Error('Paper must be configured through the file guard');
  const expected=selection.units.flatMap(unit=>selection.hosts.flatMap(host=>unit.scenarios.map(key=>scenarioExpectation(unit.id,key,host))));
  if (JSON.stringify(expected) !== JSON.stringify(selection.expectedItems)) throw new Error('saved expected items do not match selected units');
  const {resume,prepareReview,recordBindings,...executionRequest}=request;
  if(prepareReview&&!resume)throw new Error('review preparation requires saved suite evidence');
  const requestDigest=rubricDigest({request:executionRequest,selection}),stateFile=path.join(request.outputDir,'suite-state.json');
  let saved={results:[],revision:0,startedAt};
  if(resume) {
    saved=json(stateFile);const {digest,...payload}=saved;
    if(digest!==rubricDigest(payload)||saved.requestDigest!==requestDigest)throw new Error('saved suite evidence or request changed; resume refused');
    for(const item of saved.results)for(const [file,hash] of item.files)if(!fs.existsSync(file)||rubricDigest(fs.readFileSync(file,'utf8'))!==hash)throw new Error('saved suite evidence changed; resume refused');
  } else {
    fs.mkdirSync(request.outputDir); // never overwrite an earlier run
    fs.writeFileSync(path.join(request.outputDir,'expected-items.json'),JSON.stringify(selection.expectedItems,null,2)+'\n',{flag:'wx'});
  }
  // Preparation annotates one saved stage, never all earlier chain results.
  const preparationTargets=typeof prepareReview==='string'?[prepareReview]:prepareReview?Object.keys(recordBindings??{}).filter(key=>saved.results.some(item=>`${item.unit}:${item.scenario}:${item.host}`===key&&item.records?.status!=='passed')):[];
  if(prepareReview&&(preparationTargets.length!==1||!saved.results.some(item=>`${item.unit}:${item.scenario}:${item.host}`===preparationTargets[0])))throw new Error('review preparation requires exactly one saved stage binding target');
  const checkpoints=[];
  const saveState=()=>{
    const payload={requestDigest,revision:saved.revision+(resume?1:0),startedAt:saved.startedAt,results:[...checkpoints,...saved.results.filter(old=>!checkpoints.some(current=>current.unit===old.unit&&current.scenario===old.scenario&&current.host===old.host))],exportLeftovers:[...exportLeftovers]};
    const temporary=stateFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify({...payload,digest:rubricDigest(payload)},null,2)+'\n',{flag:'wx'});fs.renameSync(temporary,stateFile);
  };
  if(selection.uncovered?.length){
    const result={status:'unverified',reason:'uncovered selection',uncovered:selection.uncovered,items:[],results:[]};
    fs.writeFileSync(path.join(request.outputDir,resume?`suite-result-${saved.revision+1}.json`:'suite-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
  }
  if (!selection.expectedItems.length) {
    const result={status:'not-required',items:[],results:[]};
    fs.writeFileSync(path.join(request.outputDir,resume?`suite-result-${saved.revision+1}.json`:'suite-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
  }
  let manifestDir;
  const results=[],exportLeftovers=new Set(saved.exportLeftovers??[]);
  runs: for (const unit of selection.units) for (const host of selection.hosts) {
    const projectName=`monotest-${request.runId}-${host}-${unit.id}`;
    let project=null,previousResult=null;const chainExchanges=[];
    for (const [position,key] of unit.scenarios.entries()) {
      const outputDir=path.join(request.outputDir,`${unit.id}-${host}-${position}`);
      let result,paperLog,runRequest,scenario,observedProject,seedProject;const stageStart=Date.now();
      const prior=saved.results.find(r=>r.unit===unit.id&&r.scenario===key&&r.host===host);
      if(prepareReview&&!prior)break;
      try {
        if(prior) {
          scenario=catalog.scenarios.get(key);runRequest=prior.runRequest;result=prior.run;
          observedProject=prior.project;project=observedProject??project;
          if(result.status==='passed') {chainExchanges.push(...result.check.exchanges);checkEndings(chainExchanges);}
          if(position>0&&previousResult?.anchored&&!releaseDesignStart(previousResult,scenario.stage)&&(previousResult.status!=='passed'||!previousResult.records?.starts?.some(signal=>signal.stage===scenario.stage)))throw new Error('driver start blocked: passed rubric, scenario permission and post-reply stage signal required');
        } else {
        manifestDir ??= fs.mkdtempSync(path.join(request.cwd,`.mono-skills-${request.runId}-`));
        scenario=catalog.scenarios.get(key);
        if(position>0&&previousResult?.anchored&&!releaseDesignStart(previousResult,catalog.scenarios.get(key)?.stage)) {
          if(previousResult.status!=='passed'||!previousResult.records?.starts?.some(signal=>signal.stage===scenario.stage))throw new Error('driver start blocked: passed rubric, scenario permission and post-reply stage signal required');
        }
        if (!scenario) throw new Error(`selected scenario removed: ${key}`);
        const flow=scenario.hosts[host];
        const projectFile=path.join(manifestDir,`${unit.id}-${host}-${position}-project.json`);
        const seedProjectFile=projectFile+'.seed.json',dumpDir=projectFile+'.route';
        const seedPath=position===0 && unit.seed ? unit.seed : scenario.seed;
        if(release&&position>0&&!project)throw new Error('release lost its run project; no seeding permitted');
        const seed=!release && !project && seedPath ? JSON.parse(JSON.stringify(json(catalogFile(catalog.root,seedPath))).replaceAll('<projectName>',projectName)) : null;
        const nextKey=unit.scenarios[position+1], next=nextKey ? catalog.scenarios.get(nextKey)?.stage : scenario.next;
        const servers={...request.mcpServers};
        let exportRunDir;
        if (scenario.stage === 'design') {
          if (!Array.isArray(request.paper?.fileIds) || !request.paper.fileIds.length || request.paper.fileIds.some(id=>typeof id!=='string'||!id.trim()) || !request.paper.command || !Array.isArray(request.paper.args) || !path.isAbsolute(request.designMemoryFile ?? '')) throw new Error('Design requires nonempty fileIds, Paper command/args and test designMemoryFile');
          exportRunDir=outputDir+'-exports';fs.mkdirSync(exportRunDir);
          fs.mkdirSync(path.join(path.dirname(request.designMemoryFile),'approved'),{recursive:true});
          const guardFile=path.join(request.outputDir,`${unit.id}-${host}-${position}-paper.json`);
          fs.writeFileSync(guardFile,JSON.stringify({...request.paper,exportDir:request.paper.exportDir ?? path.join(os.homedir(),'Downloads'),exportRunDir,log:guardFile+'.jsonl'})+'\n',{flag:'wx'});
          paperLog=guardFile+'.jsonl';
          servers.paper={command:process.execPath,args:[catalogFile(catalog.root,catalog.index.paperGuard),guardFile]};
        }
        const memorySeed=scenario.stage==='design' ? json(catalogFile(catalog.root,scenario.seed)).designMemory : null;
        if(memorySeed?.mainFileRequired && (request.paper.fileIds.length<2 || request.paper.fileIds[0]===request.paper.fileIds[1])) throw new Error('Design main-file scenario requires distinct sandbox and main fileIds');
        const designMemory=memorySeed ? {...memorySeed,memoryFile:request.designMemoryFile,firstLine:`Репозиторий: ${request.cwd}`,fileId:request.paper.fileIds[0],mainFileId:request.paper.fileIds[1]??null} : null;
        if(seed&&designMemory)seed.designMemory=designMemory;
        const target=catalog.scenarios.get(unit.target);
        if (!target) throw new Error('selected unit target missing');
        const brief=(release?catalog.index.release.brief:target.brief)+` Идентификатор тестового проекта этой правки: ${projectName}. Название колонки всегда «Источник», имя прогона в него не добавляй.`;
        if(flow.expectedReplies.some(anchored)&&nextKey&&!(release&&scenario.stage==='design'&&catalog.scenarios.get(nextKey)?.stage==='tech-evaluation')) {
          const destination=catalog.scenarios.get(nextKey)?.stage;
          if(!flow.expectedReplies.some(r=>r.outcome.startNext&&permittedStages(r).includes(destination)))throw new Error('chain has no predefined next-stage permission');
        }
        const prompt=scenarioPrompt({scenario:{...scenario,brief},host,seed,seedProjectFile,projectName,projectFile,project,next,packRoot:request.packRoot,paper:scenario.stage==='design'?request.paper:null,designMemoryFile:request.designMemoryFile,
          designMemory,
          productName:catalog.index.productName,skillPrefix:catalog.index.skillPrefix,routeHint:release?catalog.index.release.routeHint:catalog.index.routeHints?.[next]});
        runRequest={host,cwd:request.cwd,packRoot:request.packRoot,outputDir,authFile:request.authFile,
          ...(scenario.stage==='design'?{writableRoots:[path.dirname(request.designMemoryFile),path.join(path.dirname(request.designMemoryFile),'approved'),exportRunDir]}:{}),
          timeoutMs:request.timeoutMs ?? 1_800_000,idleMs:20_000,maxTurns:request.maxTurns??128,mcpServers:servers,
          workspaceProof:proof,
          ...(seed?{seed:{prompt:seedPrompt({seed,projectName,projectFile:seedProjectFile,dumpDir,packRoot:request.packRoot,brief}),projectName,projectFile:seedProjectFile,dumpDir,expectedStage:seed.entryStage??null,configFile:path.join(request.cwd,'.agents/mono-workflow.config.json')}}:{}),
          context:{skillPrefix:catalog.index.skillPrefix,projectName,projectFile,project,entryStage:scenario.stage,followingStage:next},scenario:{prompt,brief,allowedTools:['*'],...flow,rubricDefinition:fs.readFileSync(path.join(path.dirname(scenario.file),'rubric.md'),'utf8')}};
        fs.writeFileSync(outputDir+'-request.json',JSON.stringify(runRequest,null,2)+'\n',{flag:'wx'});
        checkPack(request.packRoot,selection.head);
        result=await execute(runRequest);
        if(flow.expectedReplies&&result.status==='passed') {
          if(!result.check?.exchanges?.length)throw new Error('text stage exchange evidence missing');
          chainExchanges.push(...result.check.exchanges);checkEndings(chainExchanges);
        }
        checkPack(request.packRoot,selection.head);
        if (seed && result.seedRoute?.project) seedProject=projectIdentity(result.seedRoute.project,projectName);
        if (result.status !== 'failed' && (result.status==='passed'||fs.existsSync(projectFile)) && (scenario.expectedRecords.some(record=>record.type==='project') || nextKey || project || seed || fs.existsSync(projectFile))) {
          const observed=projectIdentity(json(projectFile),projectName);
          const expectedProject=project??seedProject;
          if (seed&&!expectedProject) throw new Error('validated seed project missing');
          if (expectedProject&&['id','name','url'].some(field=>observed[field]!==expectedProject[field])) throw new Error('chain changed its run project');
          fs.copyFileSync(projectFile,outputDir+'-project.json',fs.constants.COPYFILE_EXCL);
          project=observed;observedProject=observed;
        } else if (result.status==='unverified' && seedProject) {
          project=seedProject;
        }
        }
      } catch(error) {
        result={...result,status:'failed',reason:error.message};
      } finally {
        if (paperLog) try {
          for (const line of fs.readFileSync(paperLog,'utf8').split('\n').filter(line=>line.trim())) {
            const event=JSON.parse(line);
            if (event.kind==='export-leftover') {
              if (!path.isAbsolute(event.path ?? '')) throw new Error('invalid export leftover path');
              exportLeftovers.add(event.path);
            }
          }
        } catch(error) {
          if (error.code!=='ENOENT') result={...result,status:'failed',reason:`Paper guard log: ${error.message}`};
        }
      }
      const stageRun=JSON.parse(JSON.stringify(result));
      if(result && runRequest && scenario){
        try{
          if(prior&&!prior.reviewEvidence)throw new Error('saved native review evidence missing; resume refused');
          const prepareTarget=Boolean(prepareReview&&preparationTargets[0]===`${unit.id}:${key}:${host}`);
          const records=prepareReview&&prior&&!prepareTarget?prior.records:await verify({run:result,runRequest,scenario,project:observedProject??project??seedProject,outputDir:outputDir+'-records',bindingsFile:recordBindings?.[`${unit.id}:${key}:${host}`],...(prior?{resumeEvidence:prior.reviewEvidence,prepareReview:prepareTarget}: {})});
          if(!records.stop)checkPack(request.packRoot,selection.head);
          result={...result,records,status:result.status==='failed'||records.status==='failed'?'failed':result.status!=='passed'||records.status!=='passed'?'unverified':'passed'};
          // Non-target results are preserved during preparation. Certification
          // must use ordinary resume, which revalidates every saved capture.
          if(prepareTarget&&result.status==='passed')result={...result,status:'unverified',reason:'review preparation requires ordinary resume before certification'};
        }catch(error){result={...result,status:result.status==='failed'||prior?.records?.status==='failed'?'failed':'unverified',records:{...prior?.records,status:prior?.records?.status==='failed'?'failed':'unverified',reason:error.message}};}
      }
      previousResult={...result,stage:scenario?.stage,anchored:runRequest?.scenario.expectedReplies?.some(anchored)};
      const item={durationMs:Date.now()-stageStart,monotestTasks:result.records?.monotestTasks??null,unit:unit.id,scenario:key,host,status:result.status,outputDir,result};results.push(item);
      const files=[outputDir+'-request.json',outputDir+'-project.json',result.records?.reviewEvidence].filter(file=>file&&fs.existsSync(file)).map(file=>[file,rubricDigest(fs.readFileSync(file,'utf8'))]);
      checkpoints.push({unit:unit.id,scenario:key,host,run:stageRun,runRequest,project:observedProject??project??seedProject,reviewEvidence:result.records?.reviewEvidence??prior?.reviewEvidence,records:result.records,files});saveState();
      if(result.records?.stop)break runs;
      if (result.status === 'failed'||previousResult.anchored&&result.status!=='passed') break;
    }
  }
  const items=selection.expectedItems.map(expected=>{
    const actual=results.find(r=>r.unit===expected.unit && r.scenario===expected.scenario && r.host===expected.host);
    return {...expected,status:actual?.status ?? 'unverified',evidence:actual?.outputDir ?? 'previous chain stage failed',...(actual?.status==='passed'?{}:{reason:actual?.result.reason??actual?.result.records?.reason??'Предыдущий этап не прошёл полную проверку; этот этап не запускался'})};
  });
  const status=items.some(i=>i.status==='failed')?'failed':items.some(i=>i.status!=='passed')?'unverified':'passed';
  const taskCounts=results.map(r=>r.monotestTasks),taskIds=new Set(results.flatMap(r=>r.result.records?.taskIds??[]));
  const result={status,startedAt,finishedAt:new Date().toISOString(),durationMs:Date.now()-suiteStart,monotestTasks:taskCounts.some(c=>c===null)?null:taskIds.size,items,results,exportLeftovers:[...exportLeftovers],boundary:'mechanical driver results; fresh records verified separately for every host; conversation rubric remains required before a QA certificate'};
  if(release)fs.writeFileSync(path.join(request.outputDir,resume?`release-report-${saved.revision+1}.md`:'release-report.md'),releaseReport(result)+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(request.outputDir,resume?`suite-result-${saved.revision+1}.json`:'suite-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  return result;
}
export function releaseReport(result) {
 const lines=['# Выпуск скиллов','',`Цепочки: ${result.status}. Время: ${result.durationMs} ms. Задач monotest: ${result.monotestTasks??'не измерено'}.`,'',
 '| Хост / этап | Исход | Доказательство | не проверено / причина |','| --- | --- | --- | --- |'];
 for(const item of result.items)lines.push(`| ${item.host} / ${item.scenario} | ${item.status} | ${item.evidence} | ${item.status==='passed'?'—':item.reason?.replaceAll('|','/').replaceAll('\n',' ')??'Не проверено: нет причины в следе'} |`);
 lines.push('','| Клиент | Снимок полного итога и вопроса согласия | не проверено / причина |','| --- | --- | --- |');
 for(const client of ['Claude Code terminal (tmux)','Codex CLI (tmux)','Claude Code Desktop','Codex app'])lines.push(`| ${client} | не проверено | Снимок и текст панели / проба изоляции проверяются оркестратором на хосте, вне фонового драйвера |`);
 lines.push('','Приёмка проекта не подтверждена этим фоновым проходом. Обязательны ключ старых версий со снимками, повтор красного на исправленной версии один раз, реальные решения ворот broken/fixed/unverified на отдельной невливаемой ветке и проверка обычных сессий обоих хостов. Пробелы — оркестратору; владелец не снимает и не прогоняет.','',
 'Расход на правку: не проверено — этот проход измеряет выпуск; оркестратор добавляет время и уникальные задачи отдельного perChange-прохода. Основной конфиг остаётся perChange: false.');
 if(result.durationMs>8*60*60*1000)lines.push('','Выпуск дольше 8 часов: сценарии не срезаны; оркестратор заводит задачу на ускорение.');
 return lines.join('\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const result=await runSuite(json(process.argv[2])); console.log(JSON.stringify(result,null,2));process.exitCode=['passed','not-required'].includes(result.status)?0:result.status==='failed'?1:2; }
  catch(error) { console.error(error.message);process.exitCode=2; }
}
