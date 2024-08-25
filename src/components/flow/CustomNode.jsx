import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

function CustomNode({ data }) {
  return (
    <div className="px-4 py-2 shadow-sm rounded-2xl bg-[#ffffff] hover:bg-slate-50 active:bg-slate-200 hover:shadow-xl active:shadow-lg active:ring">
      <div className="flex">
        <div className="rounded-full w-12 h-12 flex justify-center items-center bg-slate-100">
          📌
        </div>
        <div className="ml-4">
          <div className="text-sky-700 text-lg font-bold">{data.label}</div>
          <div className="text-sky-400 font-medium text-sm">{data.model}</div>
          <div className="text-gray-500 text-xs">{data.description}</div>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="h-3 !bg-sky-500"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="h-3 !bg-sky-500"
      />
    </div>
  );
}

export default memo(CustomNode);
