import { useCallback, useState } from 'react';
import { ReactFlow, applyEdgeChanges, applyNodeChanges, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../styles/workflow.css'

const initialNodes = [
    {
        id: '1',
        type: 'input',
        data: { label: <div style={{color:"#086aa9", fontWeight: "bold"}}>🔍 DISCOVER</div> },
        position: { x: 100, y: 0 },
        justify: 'center',
        align: 'center',
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '2',
        type: 'input',
        data: { label: <div style={{color:"#086aa9", fontWeight: "bold"}}>👐 SHARE</div> },
        position: { x: 100, y: 50 },
        justify: 'center',
        align: 'center',
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '3',
        type: 'input',
        data: { label: <div style={{color:"#086aa9", fontWeight: "bold"}}>🌐 DOWNLOAD</div> },
        position: { x: 100, y: 100 },
        justify: 'center',
        align: 'center',
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '4',
        data: { label: <div style={{color:"#086aa9", fontWeight: "bold"}}>🔀 WorkFlows</div> },
        position: { x: 300, y: 50 },
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '5',
        type: 'input',
        data: { label: <div style={{display:"flex", justifyContent:"center"}}><img src="dify.png" style={{maxHeight: "2em"}}/></div> },
        position: { x: 300, y: 150 },
        justify: 'center',
        align: 'center',
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '6',
        type: 'output',
        data: { label: <div style={{display:"flex", justifyContent:"center"}}><img src="brand.svg" style={{maxHeight: "2em"}}/></div> },
        position: { x: 500, y: 100 },
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
        <div className='h-56 sm:h-96'>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                zoomOnScroll={false}
                panOnDrag={false}
                fitView >
                <Background />
            </ReactFlow>
        </div>
    );
};

export default ReactFlowComponent;