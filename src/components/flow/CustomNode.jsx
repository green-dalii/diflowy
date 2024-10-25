import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

const nodeIcon = new Map([
  ["start", { icon: "/nodeIcon/start.svg", bgColor: "#2970ff"}],
  ["end", { icon: "/nodeIcon/end.svg", bgColor: "#f79009"}],
  ["llm", { icon: "/nodeIcon/llm.svg", bgColor: "#6172f3"}],
  ["code", { icon: "/nodeIcon/code.svg", bgColor: "#2e90fa"}],
  ["answer", { icon: "/nodeIcon/answer.svg", bgColor: "#f79009"}],
  ["if-else", { icon: "/nodeIcon/if-else.svg", bgColor: "#06aed4"}],
  ["iteration", { icon :"/nodeIcon/iteration.svg", bgColor: "#06aed4"}],
  ["knowledge-retrieval", { icon: "/nodeIcon/knowledge-retrieval.svg", bgColor: "#16b364"}],
  ["question-classifier", { icon: "/nodeIcon/question-classifier.svg", bgColor: "#16b364"}],
  ["template-transform", { icon: "/nodeIcon/template-transform.svg", bgColor: "#2e90fa"}],
  ["variable-aggregator", { icon:"/nodeIcon/variable-aggregator.svg", bgColor: "#2e90fa"}],
  ["assigner", { icon: "/nodeIcon/assigner.svg", bgColor: "#2e90fa"}],
  ["parameter-extractor", { icon: "/nodeIcon/parameter-extractor.svg", bgColor: "#2e90fa"}],
  ["http-request", { icon: "/nodeIcon/http-request.svg", bgColor: "#875bf7"}],
  ["tool", { icon: "/nodeIcon/tool.svg", bgColor: "#2e90fa"}],
  ["iteration-start", { icon: "/nodeIcon/iteration-start.svg", bgColor: "#2970ff"}]
]);

function CustomNode({ data }) {
  const iconInfo = nodeIcon.get(data.nodeType) || { icon: "/nodeIcon/default.svg", bgColor: "#2e90fa"};
  return (
    <div className={`px-4 py-4 active:border-2 active:border-stone-300 shadow-sm rounded-3xl ${data.nodeType === "iteration" ? "bg-[#f6f6f6]" : "bg-[#ffffff]"} hover:bg-slate-50 active:bg-slate-200 hover:shadow-xl active:shadow-lg active:ring`} style={{ minWidth: data.width, minHeight: data.height, zIndex: data.zIndex || 100, }}>
      <div className="flex">
        <div className="rounded-xl w-8 h-8 flex justify-center text-3xl items-center shadow-md" style={{backgroundColor: iconInfo.bgColor}}>
          <img src={iconInfo.icon} alt={data.nodeType} className="w-5 h-5 icon-white" />
        </div>
        <div className="ml-4">
          <div className="text-black text-xl font-bold">{data.label}</div>
          <div className={`text-gray-300 font-medium text-xs ${data.nodeType === "iteration-start" ? "hidden" : ""}`}>{data.nodeType.toUpperCase()} NODE</div>
          <div className="text-sky-400 font-medium text-xs">{data.model}</div>
          <div className="text-gray-500 text-xs">{data.description}</div>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-5 !bg-sky-500"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-5 !bg-sky-500"
      />
    </div>
  );
}

export default memo(CustomNode);
