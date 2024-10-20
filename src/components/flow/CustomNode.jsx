import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

const nodeIcon = new Map([
  ["start", "▶️"],
  ["end", "🏁"],
  ["llm", "🧠"],
  ["code", "🖥️"],
  ["answer", "💬"],
  ["if-else", "🤔"],
  ["iteration", "🔄"],
  ["knowledge-retrieval", "🔍"],
  ["question-classifier", "🔠"],
  ["template-transform", "📝"],
  ["variable-aggregator", "✳️"],
  ["assigner", "✏️"],
  ["parameter-extractor", "🧲"],
  ["http-request", "🛜"],
  ["tool", "⚙️"],
]);

function CustomNode({ data }) {
  return (
    <div className="px-4 py-2 border-2 border-stone-300 shadow-sm rounded-3xl bg-[#ffffff] hover:bg-slate-50 active:bg-slate-200 hover:shadow-xl active:shadow-lg active:ring" style={{ minWidth: data.width, minHeight: data.height, zIndex: data.zIndex, }}>
      <div className="flex">
        <div className="rounded-full w-12 h-12 flex justify-center text-3xl items-center bg-slate-100">
          {nodeIcon.get(data.nodeType) || '●'}
        </div>
        <div className="ml-4">
          <div className="text-sky-700 text-xl font-black">{data.label}</div>
          <div className="text-gray-300 font-medium text-sm">{data.nodeType.toUpperCase()} NODE</div>
          <div className="text-sky-400 font-medium text-sm">{data.model}</div>
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
