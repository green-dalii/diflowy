import { useCallback, useState } from 'react';
import { ReactFlow, applyEdgeChanges, applyNodeChanges, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../styles/workflowLangding.css'
import CustomNode from './CustomNode_Landing';

const nodeTypes = {
    custom: CustomNode,
};

const initialNodes = [
    {
        id: '1',
        type: 'custom',
        data: { label: 'EXPLORE', icon: '🔍' },
        position: { x: 100, y: 0 },
        justify: 'center',
        align: 'center',
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '2',
        type: 'custom',
        data: { label: 'SHARE', icon: '👐' },
        position: { x: 100, y: 70 },
        justify: 'center',
        align: 'center',
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '3',
        type: 'custom',
        data: { label: 'DOWNLOAD', icon: '📥' },
        position: { x: 100, y: 140 },
        justify: 'center',
        align: 'center',
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '4',
        type: 'custom',
        data: { label: 'WORKFLOWS', icon: '🔀' },
        position: { x: 320, y: 70 },
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '5',
        type: 'custom',
        data: { label: <div><img src="/dify.png" alt="difyLogo" style={{maxHeight: "1.8em"}}/></div>, icon: '⭐️' },
        position: { x: 320, y: 140 },
        justify: 'center',
        align: 'center',
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '6',
        type: 'custom',
        data: { label: <div><img src="/brand.svg" alt="diflowyLogo" style={{maxHeight: "1.8em", minWidth: "5.5em"}}/></div>, icon: '🤩' },
        position: { x: 560, y: 70 },
        sourcePosition: 'right',
        targetPosition: 'left',
    },
];

const initialEdges = [
    { id: 'e1-1', source: '1', target: '4', animated: true },
    { id: 'e1-2', source: '2', target: '4', animated: true },
    { id: 'e1-3', source: '3', target: '4', animated: true },
    { id: 'e2-1', source: '4', target: '6', animated: true },
    { id: 'e2-2', source: '5', target: '6', animated: true },
];

const ReactFlowComponent = () => {
    const [nodes, setNodes] = useState(initialNodes);
    const [edges, setEdges] = useState(initialEdges);

    const onNodesChange = useCallback(
        (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
        [setNodes],
    );
    const onEdgesChange = useCallback(
        (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        [setEdges],
    );
    return (
        <div className='h-56 sm:h-[30rem]'>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                zoomOnScroll={false}
                panOnDrag={false}
                nodeTypes={nodeTypes}
                fitView >
                <Background />
            </ReactFlow>
        </div>
    );
};

export default ReactFlowComponent;